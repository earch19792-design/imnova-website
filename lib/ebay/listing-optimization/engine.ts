import type {
  ExperimentPlan,
  ImageBrief,
  ListingDraft,
  ListingMetrics,
  ListingOptimizationInput,
  ListingOptimizationResult,
  ListingScore,
  OptimizationIssue,
  ProductFacts,
  TitleCandidate,
} from "./types.ts"

function normalized(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ")
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function safeFactualLabel(value: string, input: ListingOptimizationInput) {
  let safe = value
  for (const prohibited of [...input.productFacts.prohibitedClaims, ...input.platformConstraints.prohibitedTerms]) {
    if (!prohibited) continue
    safe = safe.replace(new RegExp(escapeRegExp(prohibited), "gi"), " ")
  }
  return safe
    .replace(/\b(covid(?:-19)?|coronavirus)\b/gi, " ")
    .replace(/\b(treats?|prevents?|cures?)\s+(?:disease|illness|infection|virus|flu)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function issue(
  code: string,
  severity: OptimizationIssue["severity"],
  field: string,
  message: string,
  evidence: string[] = [],
): OptimizationIssue {
  return { code, severity, field, message, evidence }
}

function draftText(draft: ListingDraft, imageText: string[]) {
  return [
    draft.title,
    draft.subtitle ?? "",
    draft.description,
    draft.shippingPolicy,
    draft.returnPolicy,
    ...Object.entries(draft.itemSpecifics).flat(),
    ...imageText,
  ].join("\n")
}

function claimAllowed(claim: string, facts: ProductFacts, regulatoryClaims: string[]) {
  const clean = normalized(claim)
  return [...facts.permittedClaims, ...regulatoryClaims]
    .some((allowed) => normalized(allowed).includes(clean) || clean.includes(normalized(allowed)))
}

export function evaluateListingCompliance(input: ListingOptimizationInput) {
  const blockingIssues: OptimizationIssue[] = []
  const warnings: OptimizationIssue[] = []
  const passedChecks: string[] = []
  const imageText = input.imageAssets.flatMap((asset) => asset.observedText)
  const corpus = draftText(input.listingDraft, imageText)
  const lower = normalized(corpus)
  const facts = input.productFacts
  const regulatory = input.regulatoryData
  const addBlocking = (...args: Parameters<typeof issue>) => blockingIssues.push(issue(...args))
  const addWarning = (...args: Parameters<typeof issue>) => warnings.push(issue(...args))

  if (/\b(covid(?:-19)?|coronavirus)\b/i.test(corpus)) {
    addBlocking("PROHIBITED_COVID_REFERENCE", "blocking", "content", "COVID-19 or coronavirus references are prohibited.")
  } else passedChecks.push("NO_PROHIBITED_COVID_REFERENCE")

  if (/\b(treats?|prevents?|cures?)\b.{0,40}\b(disease|illness|infection|virus|flu|covid)/i.test(corpus)) {
    addBlocking("UNVERIFIED_DISEASE_CLAIM", "blocking", "content", "Disease treatment, prevention or cure claim detected.")
  } else passedChecks.push("NO_DISEASE_TREATMENT_CLAIM")

  const allProhibited = [...facts.prohibitedClaims, ...input.platformConstraints.prohibitedTerms]
  for (const prohibited of allProhibited) {
    if (prohibited && lower.includes(normalized(prohibited))) {
      addBlocking("PROHIBITED_CLAIM_PRESENT", "blocking", "content", `Prohibited term detected: ${prohibited}.`, [prohibited])
    }
  }

  const killsClaim = corpus.match(/kills?\s+99(?:\.9)?%/i)?.[0]
  if (killsClaim && !claimAllowed(killsClaim, facts, regulatory.confirmedRegulatoryClaims)) {
    addBlocking("KILLS_99_9_NOT_PERMITTED", "blocking", "content", "Kills 99.9% claim is not present in permitted claims.", [killsClaim])
  }

  const regulatoryProduct = /disinfect|pesticid|sanitiz/i.test(`${facts.productType} ${facts.productName}`) ||
    facts.permittedClaims.some((claim) => /kills?|disinfect|sanitiz/i.test(claim))
  if (regulatoryProduct && !facts.epaRegistrationNumber) {
    addBlocking("EPA_REGISTRATION_REQUIRED", "blocking", "productFacts.epaRegistrationNumber", "EPA Registration Number is required for the supplied regulatory product facts.")
  } else if (facts.epaRegistrationNumber &&
    regulatory.confirmedEpaRegistrationNumber !== facts.epaRegistrationNumber) {
    addBlocking("EPA_REGISTRATION_UNCONFIRMED", "blocking", "regulatoryData.confirmedEpaRegistrationNumber", "EPA Registration Number is absent or inconsistent with product facts.")
  } else passedChecks.push("EPA_REGISTRATION_CONSISTENT")

  const draftEpa = input.listingDraft.itemSpecifics["EPA Registration Number"]
  if (draftEpa && draftEpa !== facts.epaRegistrationNumber) {
    addBlocking("DRAFT_EPA_REGISTRATION_CONTRADICTS_FACTS", "blocking", "itemSpecifics.EPA Registration Number", "Draft EPA number contradicts product facts.")
  }

  if (regulatory.brandUsageAuthorized === false) {
    addBlocking("BRAND_USAGE_NOT_AUTHORIZED", "blocking", "productFacts.brand", "Brand usage is explicitly not authorized.")
  } else passedChecks.push("BRAND_USAGE_NOT_REJECTED")

  const packMatches = [...corpus.matchAll(/\b(\d+)\s*(?:pack|pk)\b/gi)].map((match) => Number(match[1]))
  if (packMatches.some((value) => value !== facts.quantityIncluded)) {
    addBlocking("QUANTITY_CONTRADICTION", "blocking", "content", "Pack quantity contradicts product facts.", packMatches.map(String))
  } else passedChecks.push("PACK_QUANTITY_CONSISTENT")
  const countMatches = [...corpus.matchAll(/\b(\d+)\s*(?:count|ct)\b/gi)].map((match) => Number(match[1]))
  if (countMatches.some((value) => value !== facts.totalUnits && value !== facts.unitsPerPackage)) {
    addBlocking("TOTAL_UNIT_COUNT_CONTRADICTION", "blocking", "content", "Count statement contradicts verified units per package or total units.", countMatches.map(String))
  } else passedChecks.push("TOTAL_UNIT_COUNT_CONSISTENT")

  const draftUpc = input.listingDraft.itemSpecifics.UPC
  if (draftUpc && draftUpc !== facts.upc) {
    addBlocking("UPC_CONTRADICTION", "blocking", "itemSpecifics.UPC", "Draft UPC contradicts product facts.")
  } else passedChecks.push("UPC_NOT_CONTRADICTED")
  if (!facts.upc && !facts.manufacturerPartNumber) {
    addBlocking("PRODUCT_IDENTIFIER_MISSING", "blocking", "productFacts", "UPC and manufacturer part number are both unavailable.")
  }
  if (facts.totalUnits !== facts.quantityIncluded * facts.unitsPerPackage) {
    addBlocking("PRODUCT_QUANTITY_STRUCTURE_INCONSISTENT", "blocking", "productFacts.totalUnits", "Total units must equal quantity included multiplied by units per package.")
  }
  if (!facts.packageContents.length) addBlocking("PACKAGE_CONTENTS_MISSING", "blocking", "productFacts.packageContents", "Verified package contents are required.")
  if (!facts.dimensions) addBlocking("DIMENSIONS_MISSING", "blocking", "productFacts.dimensions", "Verified package dimensions are required.")
  if (!facts.weight) addBlocking("WEIGHT_MISSING", "blocking", "productFacts.weight", "Verified package weight is required.")
  if (!facts.shippingOrigin) addBlocking("SHIPPING_ORIGIN_MISSING", "blocking", "productFacts.shippingOrigin", "Verified shipping origin is required.")
  if (facts.handlingTime === null) addBlocking("HANDLING_TIME_MISSING", "blocking", "productFacts.handlingTime", "Verified handling time is required.")
  if (!facts.returnPolicy) addBlocking("RETURN_POLICY_MISSING", "blocking", "productFacts.returnPolicy", "Verified return policy is required.")
  if (!input.listingDraft.category.trim()) addBlocking("CATEGORY_MISSING", "blocking", "listingDraft.category", "eBay category is required.")
  if (input.listingDraft.images.length > input.platformConstraints.maximumImages) {
    addBlocking("IMAGE_COUNT_EXCEEDS_PLATFORM_LIMIT", "blocking", "listingDraft.images", "Image count exceeds the configured platform maximum.")
  }

  for (const asset of input.imageAssets) {
    if (asset.observedQuantity !== null && asset.observedQuantity !== facts.quantityIncluded) {
      addBlocking("IMAGE_QUANTITY_CONTRADICTION", "blocking", `imageAssets.${asset.id}`, "Image quantity contradicts product facts.", [asset.url])
    }
    if (asset.observedTotalUnits !== null && asset.observedTotalUnits !== facts.totalUnits) {
      addBlocking("IMAGE_TOTAL_UNITS_CONTRADICTION", "blocking", `imageAssets.${asset.id}`, "Image total units contradict product facts.", [asset.url])
    }
    if (asset.medicalTextDetected) {
      addBlocking("IMAGE_MEDICAL_TEXT_PROHIBITED", "blocking", `imageAssets.${asset.id}`, "Image contains unapproved medical text.", [asset.url])
    }
    const observedUpcs = asset.observedText.flatMap((text) => text.match(/\b\d{8,14}\b/g) ?? [])
    if (facts.upc && observedUpcs.some((value) => value !== facts.upc)) {
      addBlocking("IMAGE_UPC_CONTRADICTION", "blocking", `imageAssets.${asset.id}`, "Image contains a UPC different from product facts.", observedUpcs)
    }
    const observedBrand = asset.observedText
      .map((text) => text.match(/^brand\s*:\s*(.+)$/i)?.[1]?.trim())
      .find(Boolean)
    if (observedBrand && normalized(observedBrand) !== normalized(facts.brand)) {
      addBlocking("IMAGE_BRAND_CONTRADICTION", "blocking", `imageAssets.${asset.id}`, "Image brand label contradicts product facts.", [observedBrand])
    }
  }
  if (!blockingIssues.some((entry) => entry.code.startsWith("IMAGE_"))) passedChecks.push("IMAGE_FACTS_CONSISTENT")

  if (/free shipping/i.test(corpus) && !input.sellerProfile.freeShipping) {
    addBlocking("FREE_SHIPPING_NOT_SUPPORTED", "blocking", "shippingPolicy", "Free Shipping is stated but the seller profile does not offer it.")
  } else passedChecks.push("FREE_SHIPPING_CLAIM_CONSISTENT")
  if (/made in (?:the )?usa/i.test(corpus) && !regulatory.madeInUsaConfirmed) {
    addBlocking("MADE_IN_USA_UNCONFIRMED", "blocking", "content", "Made in USA is not confirmed.")
  }
  if (/usa seller/i.test(corpus) && !regulatory.usaSellerConfirmed) {
    addBlocking("USA_SELLER_UNCONFIRMED", "blocking", "content", "USA Seller is not confirmed.")
  }
  if (/tsa approved/i.test(corpus) && !regulatory.tsaApprovedConfirmed) {
    addBlocking("TSA_APPROVED_UNCONFIRMED", "blocking", "content", "TSA Approved is not confirmed.")
  }

  if (!normalized(input.listingDraft.title).startsWith(normalized(facts.brand))) {
    addWarning("BRAND_NOT_FIRST_IN_TITLE", "medium", "title", "Brand should appear at the beginning of the title.")
  } else passedChecks.push("BRAND_FIRST_IN_TITLE")
  if (input.listingDraft.title.length > input.platformConstraints.maximumTitleLength) {
    addBlocking("TITLE_EXCEEDS_PLATFORM_LIMIT", "blocking", "title", "Title exceeds the configured eBay maximum.")
  }
  if (input.listingDraft.price < input.marketIntelligenceReport.minimumSafePrice.salePrice) {
    addBlocking("PRICE_BELOW_MINIMUM_SAFE_PRICE", "blocking", "price", "Draft price is below the Market Intelligence minimum safe price.")
  }
  if (input.platformConstraints.minimumPrice !== null && input.listingDraft.price < input.platformConstraints.minimumPrice) {
    addBlocking("PRICE_BELOW_PLATFORM_MINIMUM", "blocking", "price", "Draft price is below the configured platform minimum.")
  }
  if (input.platformConstraints.maximumPrice !== null && input.listingDraft.price > input.platformConstraints.maximumPrice) {
    addBlocking("PRICE_ABOVE_PLATFORM_MAXIMUM", "blocking", "price", "Draft price is above the configured platform maximum.")
  }

  return {
    blockingIssues: unique(blockingIssues.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry) as OptimizationIssue),
    warnings: unique(warnings.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry) as OptimizationIssue),
    passedChecks: unique(passedChecks),
  }
}

function trimTitle(value: string, maximum: number) {
  if (value.length <= maximum) return value
  return value.slice(0, maximum + 1).replace(/\s+\S*$/, "").trim()
}

function titleScore(title: string, input: ListingOptimizationInput): TitleCandidate {
  const facts = input.productFacts
  const clean = normalized(title)
  const marketKeywords = input.marketIntelligenceReport.titleKeywordAnalysis?.keywords ?? []
  const factualWords = unique(normalized(`${facts.brand} ${facts.productName} ${facts.productType}`)
    .split(" ").filter((word) => word.length > 2))
  const relevance = Math.min(25, factualWords.filter((word) => clean.includes(word)).length * 4 +
    marketKeywords.filter((word) => factualWords.includes(normalized(word)) && clean.includes(normalized(word))).length)
  const clarity = title.length <= input.platformConstraints.maximumTitleLength && title.split(/\s+/).length <= 16 ? 20 : 10
  const quantityClarity = clean.includes(`${facts.quantityIncluded} pack`) &&
    (clean.includes(`${facts.totalUnits} count`) || clean.includes(`${facts.totalUnits} ct`)) ? 20 : 8
  const mobileReadability = title.length <= 65 ? 15 : title.length <= 80 ? 11 : 3
  const compliance = [...facts.prohibitedClaims, ...input.platformConstraints.prohibitedTerms]
    .some((term) => clean.includes(normalized(term))) ? 0 : 20
  const words = title.toLocaleLowerCase().split(/\s+/)
  const duplicationPenalty = Math.max(0, words.length - new Set(words).size) * 4
  const score = Math.max(0, Math.min(100, relevance + clarity + quantityClarity + mobileReadability + compliance - duplicationPenalty))
  return {
    title,
    score,
    scoreAxes: { keywordRelevance: relevance, clarity, quantityClarity, mobileReadability, compliance, duplicationPenalty },
    evidence: [
      `Brand: ${facts.brand}`,
      `Product: ${facts.productName}`,
      `Quantity: ${facts.quantityIncluded} pack`,
      `Verified total units: ${facts.totalUnits}`,
      ...(facts.scent ? [`Scent: ${facts.scent}`] : []),
    ],
  }
}

export function generateTitleCandidates(input: ListingOptimizationInput) {
  const facts = input.productFacts
  const productName = safeFactualLabel(facts.productName, input)
  const productType = safeFactualLabel(facts.productType, input)
  const scent = facts.scent ? ` ${facts.scent}` : ""
  const quantity = `${facts.quantityIncluded} Pack ${facts.totalUnits} Count`
  const raw = [
    `${facts.brand} ${productName} ${quantity}${scent}`,
    `${facts.brand} ${productType}${scent} ${quantity}`,
    `${facts.brand} ${productName}${scent} ${facts.quantityIncluded} Pack ${facts.unitsPerPackage} Count Each`,
    `${facts.brand} ${productType} ${facts.quantityIncluded} Pack ${facts.totalUnits} Ct${scent}`,
    `${facts.brand} ${productName} ${facts.totalUnits} Total Count ${facts.quantityIncluded} Pack${scent}`,
  ].map((title) => trimTitle(title.replace(/\s+/g, " ").trim(), input.platformConstraints.maximumTitleLength))
  return unique(raw).map((title) => titleScore(title, input))
    .sort((left, right) => right.score - left.score || left.title.length - right.title.length)
    .slice(0, 5)
}

export function generateVerifiedDescription(input: ListingOptimizationInput) {
  const facts = input.productFacts
  const productName = safeFactualLabel(facts.productName, input)
  const productType = safeFactualLabel(facts.productType, input)
  const dimensions = facts.dimensions
    ? `${facts.dimensions.length} × ${facts.dimensions.width} × ${facts.dimensions.height} ${facts.dimensions.unit}`
    : "Not verified"
  const weight = facts.weight ? `${facts.weight.value} ${facts.weight.unit}` : "Not verified"
  const lines = [
    "Product summary",
    `${facts.brand} ${productName}. ${facts.condition} condition.`,
    "",
    "What is included",
    `- ${facts.quantityIncluded} package${facts.quantityIncluded === 1 ? "" : "s"}`,
    `- ${facts.unitsPerPackage} units per package`,
    `- ${facts.totalUnits} total units`,
    ...facts.packageContents.map((content) => `- ${content}`),
    "",
    "Product details",
    `- Product type: ${productType}`,
    ...(facts.scent ? [`- Scent: ${facts.scent}`] : []),
    `- Dimensions: ${dimensions}`,
    `- Weight: ${weight}`,
    ...(facts.upc ? [`- UPC: ${facts.upc}`] : []),
    ...(facts.manufacturerPartNumber ? [`- MPN: ${facts.manufacturerPartNumber}`] : []),
    "",
    "Suggested uses",
    ...(facts.verifiedUseCases.length ? facts.verifiedUseCases.map((use) => `- ${use}`) : ["- No verified use cases supplied"]),
    "",
    "Shipping",
    ...(facts.shippingOrigin ? [`- Ships from: ${facts.shippingOrigin}`] : ["- Shipping origin not verified"]),
    ...(facts.handlingTime !== null ? [`- Handling time: ${facts.handlingTime} business day(s)`] : ["- Handling time not verified"]),
    "",
    "Returns",
    `- ${facts.returnPolicy ?? "Return policy not verified"}`,
    "",
    "Important notes",
    "- Review the label and manufacturer instructions before use.",
    "- Only verified product facts are presented in this listing.",
  ]
  return lines.join("\n")
}

export function generateImageBrief(input: ListingOptimizationInput): ImageBrief[] {
  const facts = input.productFacts
  const identity = `${facts.brand} ${safeFactualLabel(facts.productName, input)}, ${facts.quantityIncluded} packages, ${facts.unitsPerPackage} units each, ${facts.totalUnits} total units`
  const prohibited = unique(["COVID-19", "coronavirus", "medical claims", "unverified regulatory claims", ...facts.prohibitedClaims])
  const common = (imageNumber: number, name: string, purpose: string, conversionGoal: string, composition: string, coverage: number, allowedText: string[], requiredFacts: string[]) => ({
    imageNumber, name, purpose, conversionGoal, composition, productCoveragePercent: coverage,
    allowedText,
    prohibitedText: prohibited,
    requiredFacts,
    riskChecks: ["Exact package quantity", "Exact total units", "No prohibited claims", "Brand and package must match product facts"],
    generationPrompt: `${name}. Create an accurate eBay product image for ${identity}. ${composition}. Preserve the real product, packaging, colors and proportions. Do not add accessories, certifications, claims or text not listed in allowedText.`,
  })
  return [
    common(1, "Main Hero", "Primary search-result image", "Maximize clarity and trust on mobile", "Pure white background; complete quantity visible; centered product occupying 82% of frame; no decorative elements", 82, [`${facts.quantityIncluded} Pack`], [identity]),
    common(2, "Package Contents", "Explain exactly what buyers receive", "Eliminate quantity confusion", "Clean arrangement of every included package with unobstructed labels", 78, [`${facts.quantityIncluded} packages`, `${facts.totalUnits} total units`], [identity, ...facts.packageContents]),
    common(3, "Use Cases", "Show verified contexts", "Connect product to relevant uses", `One central idea with up to four verified contexts: ${facts.verifiedUseCases.slice(0, 4).join(", ") || "none supplied"}`, 55, [], facts.verifiedUseCases.slice(0, 4)),
    common(4, "Product in Action", "Demonstrate verified use", "Reduce uncertainty about practical use", `Realistic scene with human hands and product visible; only these compatible contexts: ${facts.verifiedCompatibility.join(", ") || "none supplied"}`, 45, [], facts.verifiedCompatibility),
    common(5, "Lifestyle", "Communicate portability and convenience", "Build everyday relevance", facts.verifiedUseCases.length
      ? `Realistic setting limited to these verified use cases: ${facts.verifiedUseCases.join(", ")}; product remains the visual protagonist`
      : "Clean everyday scale scene without implying an unverified use case; product remains the visual protagonist", 50, [], [identity, ...facts.verifiedUseCases]),
    common(6, "Trust / Scale", "Show real-world scale", "Increase confidence in size and quantity", "Real person holding the product in an everyday environment; visible scale; no exaggeration", 55, [], [identity, ...(facts.dimensions ? [`Dimensions ${facts.dimensions.length} × ${facts.dimensions.width} × ${facts.dimensions.height} ${facts.dimensions.unit}`] : [])]),
  ]
}

function includesSection(description: string, section: string) {
  return normalized(description).includes(normalized(section))
}

export function calculateListingScore(input: ListingOptimizationInput, review = evaluateListingCompliance(input)): ListingScore {
  const candidates = generateTitleCandidates(input)
  const currentTitle = titleScore(input.listingDraft.title, input)
  const target = input.marketIntelligenceReport.recommendedPrice.salePrice
  const priceDistance = Math.abs(input.listingDraft.price - target) / target
  const approved = input.imageAssets.filter((asset) => asset.status === "approved")
  const main = approved.find((asset) => input.listingDraft.images[0] === asset.id || input.listingDraft.images[0] === asset.url)
  const titleSeo = Math.min(15, Math.round(currentTitle.score * 0.15))
  const priceCompetitiveness = input.listingDraft.price < input.marketIntelligenceReport.minimumSafePrice.salePrice
    ? 0 : priceDistance <= 0.05 ? 15 : priceDistance <= 0.15 ? 11 : 6
  const mainImage = main
    ? Math.min(20, Math.round(
        (main.background && /white/i.test(main.background) ? 5 : 1) +
        ((main.productCoveragePercent ?? 0) >= 80 && (main.productCoveragePercent ?? 0) <= 85 ? 5 : 2) +
        ((main.imageSharpness ?? 0) / 100) * 5 + ((main.mobileReadability ?? 0) / 100) * 5,
      )) : 0
  const secondaryImages = Math.min(15, Math.round(Math.max(0, approved.length - 1) / 5 * 15))
  const requiredSpecifics = ["Brand", "Type", "Condition", "Quantity", "Total Units"]
  const specificsReady = requiredSpecifics.filter((field) => Boolean(input.listingDraft.itemSpecifics[field])).length
  const itemSpecifics = Math.round(specificsReady / requiredSpecifics.length * 10)
  const descriptionSections = ["Product summary", "What is included", "Product details", "Suggested uses", "Shipping", "Returns", "Important notes"]
  const description = Math.round(descriptionSections.filter((section) => includesSection(input.listingDraft.description, section)).length / descriptionSections.length * 10)
  const shipping = input.productFacts.handlingTime !== null &&
    (!input.sellerProfile.freeShipping || /free shipping/i.test(input.listingDraft.shippingPolicy)) ? 5 : 2
  const returns = input.productFacts.returnPolicy && normalized(input.listingDraft.returnPolicy).includes(normalized(input.productFacts.returnPolicy)) ? 5 : 2
  const compliance = review.blockingIssues.length ? 0 : review.warnings.some((entry) => entry.severity === "high") ? 2 : 5
  const components = { titleSeo, priceCompetitiveness, mainImage, secondaryImages, itemSpecifics, description, shipping, returns, compliance }
  const uncappedTotal = Object.values(components).reduce((sum, value) => sum + value, 0)
  return {
    total: review.blockingIssues.length ? Math.min(60, uncappedTotal) : uncappedTotal,
    uncappedTotal,
    cappedByBlockingIssue: review.blockingIssues.length > 0,
    components,
  }
}

function safeItemSpecifics(facts: ProductFacts, current: Record<string, string>) {
  return {
    ...current,
    Brand: facts.brand,
    Type: facts.productType,
    Condition: facts.condition,
    Quantity: `${facts.quantityIncluded}`,
    "Units per Package": `${facts.unitsPerPackage}`,
    "Total Units": `${facts.totalUnits}`,
    ...(facts.scent ? { Scent: facts.scent } : {}),
    ...(facts.upc ? { UPC: facts.upc } : {}),
    ...(facts.manufacturerPartNumber ? { MPN: facts.manufacturerPartNumber } : {}),
  }
}

function approvalProposals(input: ListingOptimizationInput, review: ReturnType<typeof evaluateListingCompliance>) {
  const proposals: Array<{ field: string; currentValue: unknown; proposedValue: unknown; reason: string; requiresHumanApproval: true }> = []
  const recommendedPrice = input.marketIntelligenceReport.recommendedPrice.salePrice
  if (input.listingDraft.price !== recommendedPrice) proposals.push({
    field: "price", currentValue: input.listingDraft.price, proposedValue: recommendedPrice,
    reason: "Market Intelligence recommended price; price changes require human approval.", requiresHumanApproval: true,
  })
  for (const regulatoryIssue of review.blockingIssues.filter((entry) => /EPA|REGULATORY|CLAIM/.test(entry.code))) {
    proposals.push({ field: regulatoryIssue.field, currentValue: null, proposedValue: "REVIEW_REQUIRED", reason: regulatoryIssue.message, requiresHumanApproval: true })
  }
  return proposals
}

function generateExperiment(input: ListingOptimizationInput, score: ListingScore, recommendedTitle: string): ExperimentPlan {
  const component = Object.entries(score.components).sort((left, right) => left[1] - right[1])[0]?.[0]
  if (component === "mainImage" || component === "secondaryImages") return {
    variable: "mainImage", hypothesis: "A clearer approved white-background hero will improve CTR.",
    control: input.listingDraft.images[0] ?? null, variant: "IMAGE_1_MAIN_HERO_APPROVED_ASSET",
    metric: "ctr", duration: "14 days", minimumImpressions: 500, successThreshold: "+10% CTR with no conversion decline",
    rollbackCondition: "CTR declines by 5% or conversion rate declines materially", status: "proposed",
  }
  if (component === "titleSeo") return {
    variable: "title", hypothesis: "A fact-verified, quantity-clear title will improve qualified impressions.",
    control: input.listingDraft.title, variant: recommendedTitle, metric: "impressions and ctr", duration: "14 days",
    minimumImpressions: 500, successThreshold: "+8% impressions without CTR decline", rollbackCondition: "CTR declines by 5%", status: "proposed",
  }
  return {
    variable: "price", hypothesis: "The Market Intelligence target price may improve conversion while preserving margin.",
    control: input.listingDraft.price, variant: input.marketIntelligenceReport.recommendedPrice.salePrice,
    metric: "conversionRate and profitPerOrder", duration: "14 days", minimumImpressions: 500,
    successThreshold: "+5% conversion with target margin preserved", rollbackCondition: "Profit per order falls below target", status: "proposed",
  }
}

export function diagnoseListingMetrics(metrics: ListingMetrics) {
  const diagnostics: string[] = []
  if (metrics.impressions < 500) diagnostics.push("LOW_IMPRESSIONS_REVIEW_TITLE_CATEGORY_KEYWORDS")
  if (metrics.impressions >= 500 && metrics.ctr < 1.5) diagnostics.push("GOOD_IMPRESSIONS_LOW_CTR_REVIEW_MAIN_IMAGE_PRICE")
  if (metrics.ctr >= 1.5 && metrics.conversionRate < 2) diagnostics.push("GOOD_CTR_LOW_CONVERSION_REVIEW_DESCRIPTION_COMPATIBILITY_SHIPPING_RETURNS")
  if (metrics.purchases >= 10 && metrics.profitPerOrder <= 0) diagnostics.push("HIGH_SALES_LOW_PROFIT_REVIEW_PRICE_PROMOTIONS_DISCOUNTS")
  if (metrics.returnRate >= 5) diagnostics.push("HIGH_RETURNS_REVIEW_INFORMATION_QUANTITY_DIMENSIONS_EXPECTATIONS")
  return diagnostics
}

const EMPTY_METRICS: ListingMetrics = {
  impressions: 0, clicks: 0, ctr: 0, watchers: 0, addToCart: 0, purchases: 0,
  conversionRate: 0, averageOrderValue: 0, returnRate: 0, cancellationRate: 0, profitPerOrder: 0,
}

export function runListingOptimizationLoop(input: ListingOptimizationInput, generatedAt = new Date()): ListingOptimizationResult {
  let draft = structuredClone(input.listingDraft)
  const history: ListingOptimizationResult["optimizationHistory"] = []
  const titles = generateTitleCandidates(input)
  const recommendedTitle = titles[0]
  const generatedDescription = generateVerifiedDescription(input)
  let stopReason = "MAXIMUM_5_ITERATIONS_REACHED"
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    const beforeInput = { ...input, listingDraft: draft }
    const beforeReview = evaluateListingCompliance(beforeInput)
    const beforeScore = calculateListingScore(beforeInput, beforeReview)
    const automaticCorrections: string[] = []
    const next = structuredClone(draft)
    if (next.title !== recommendedTitle.title) { next.title = recommendedTitle.title; automaticCorrections.push("TITLE_REPLACED_WITH_FACT_VERIFIED_CANDIDATE") }
    if (next.description !== generatedDescription) { next.description = generatedDescription; automaticCorrections.push("DESCRIPTION_REBUILT_FROM_PRODUCT_FACTS") }
    const specifics = safeItemSpecifics(input.productFacts, next.itemSpecifics)
    if (JSON.stringify(specifics) !== JSON.stringify(next.itemSpecifics)) { next.itemSpecifics = specifics; automaticCorrections.push("SAFE_ITEM_SPECIFICS_ALIGNED_TO_PRODUCT_FACTS") }
    draft = next
    const afterInput = { ...input, listingDraft: draft }
    const afterReview = evaluateListingCompliance(afterInput)
    const afterScore = calculateListingScore(afterInput, afterReview)
    const highRisk = afterReview.warnings.some((entry) => entry.severity === "high")
    const complete = afterScore.total >= 90 && !afterReview.blockingIssues.length && !highRisk
    const noMoreSafeChanges = automaticCorrections.length === 0
    const stoppedReason = complete ? "SCORE_90_NO_BLOCKERS_NO_HIGH_RISK_WARNINGS" : noMoreSafeChanges ? "HUMAN_APPROVAL_OR_FACTS_REQUIRED" : null
    history.push({
      iteration, scoreBefore: beforeScore.total, scoreAfter: afterScore.total,
      weaknesses: [...beforeReview.blockingIssues, ...beforeReview.warnings].map((entry) => entry.code),
      automaticCorrections,
      approvalProposals: approvalProposals(afterInput, afterReview),
      stoppedReason,
    })
    if (stoppedReason) { stopReason = stoppedReason; break }
  }
  const finalInput = { ...input, listingDraft: draft }
  const compliance = evaluateListingCompliance(finalInput)
  const score = calculateListingScore(finalInput, compliance)
  return {
    version: "EBAY_LISTING_OPTIMIZATION_LOOP_V1",
    generatedAt: generatedAt.toISOString(),
    listingDraft: draft,
    titleCandidates: titles,
    recommendedTitle,
    description: generatedDescription,
    imageBrief: generateImageBrief(input),
    review: {
      ...compliance,
      score,
      priceProposal: input.listingDraft.price === input.marketIntelligenceReport.recommendedPrice.salePrice
        ? null : input.marketIntelligenceReport.recommendedPrice.salePrice,
      regulatoryProposals: compliance.blockingIssues.filter((entry) => /EPA|REGULATORY|CLAIM/.test(entry.code)),
    },
    experimentPlan: generateExperiment(finalInput, score, recommendedTitle.title),
    optimizationHistory: history,
    metricsTemplate: { ...EMPTY_METRICS },
    diagnostics: diagnoseListingMetrics(EMPTY_METRICS),
    stopReason,
    safety: {
      productFactsOnlySourceOfTruth: true,
      priceChangedAutomatically: false,
      regulatoryDataChangedAutomatically: false,
      ebayWriteUsed: false,
      canPublish: false,
    },
  }
}
