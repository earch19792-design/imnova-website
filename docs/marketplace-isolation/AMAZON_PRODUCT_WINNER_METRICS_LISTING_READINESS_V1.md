# Amazon Product Winner Metrics + Listing Readiness V1

Loop 149A creates a local, dry-run framework for Amazon product evaluation. It does not connect to Amazon, does not write to Seller Central, does not publish offers, does not write to staging, and does not touch production systems.

## How Listing Works On Amazon

Amazon is catalog-first. A seller usually does not create a new product page when the catalog already has the same product. The first gate is matching the exact product to an existing ASIN, including brand, model, pack size, variation, condition, and compliance details.

If the exact product exists, the correct strategy is `SELL_ON_EXISTING_ASIN`. The seller creates or prepares an offer against that ASIN, subject to account, category, brand, invoice, and condition gates.

If the product does not exist, the seller may need `CREATE_NEW_ASIN`, but only after confirming that no duplicate ASIN would be created. A new ASIN also needs enough product identity data, category attributes, compliant listing content, images, and either GTIN data or an exemption path.

Some products should not advance yet. The framework can return `NEED_GTIN_OR_EXEMPTION`, `NEED_BRAND_APPROVAL`, or `REJECT_FOR_NOW` when the identity, authorization, or risk state is not acceptable.

## Product Winner Metrics

The winner model estimates whether a product deserves Amazon work before account setup or publication. It uses only sanitized fixture inputs.

Core demand signals:

- `demandScore`
- `bsrSignalScore`
- `estimatedMonthlySalesSignal`
- `keywordDemandScore`

Competition and quality signals:

- `competitionScore`
- `reviewBarrierScore`
- `ratingQualityScore`
- `buyBoxDifficultyScore`
- `fbaFbmFitScore`

Profitability signals:

- `marginScore`
- `roiScore`
- `feeRiskScore`

Restriction and supply risks:

- `categoryRestrictionRisk`
- `brandIpRisk`
- `hazmatRisk`
- `expirationRisk`
- `supplyRisk`

Opportunity signals:

- `differentiationOpportunityScore`
- `listingWeaknessOpportunityScore`
- `amazonWinnerScore`

High demand is not enough. Review walls, Buy Box difficulty, low margin, restricted categories, brand gates, hazmat, expiration, weak supply proof, and missing data all reduce the score or force an approval-oriented decision.

## Listing Readiness Metrics

Listing readiness measures whether the product can be prepared for Amazon without violating catalog rules or content rules.

Readiness signals:

- `asinStrategy`
- `titleReadinessScore`
- `bulletReadinessScore`
- `imageReadinessScore`
- `backendKeywordReadinessScore`
- `categoryAttributeCompletenessScore`
- `complianceReadinessScore`
- `priceCompetitivenessScore`
- `conversionReadinessScore`
- `listingReadinessScore`

`asinStrategy` is intentionally separate from listing content. A product can have strong title and image readiness but still be blocked because it belongs on an existing ASIN, needs GTIN data, requires brand approval, or sits in a restricted category.

## What Can Be Copied

Amazon research can model patterns, not steal assets.

Allowed:

- Use top listings to understand category language, buyer intent, attribute coverage, image count expectations, price bands, review barriers, and feature structure.
- Use winning keywords as research inputs.
- Build original titles, bullets, backend keywords, and image briefs from verified product facts.

Not allowed:

- Do not copy exact titles, bullets, descriptions, image compositions, claims, or brand language from another listing.
- Do not use protected brand names as keywords unless the product is authentic and the seller is authorized.
- Do not use medical claims.
- Do not use claims that have not been confirmed by supplier documentation or product facts.
- Do not create duplicate ASINs.

## Keyword Usage

Winning keywords are research signals. They help reveal demand, search intent, vocabulary, and missing attributes. The output must still be original and fact-based.

The adapter blocks exact listing copy, unauthorized trademark keyword use, medical claims, and unconfirmed claims. When these risks are present, keyword research is not considered ready for listing content.

## Key Amazon Risks

Buy Box risk: Competing against established FBA sellers, Amazon retail, low-price sellers, or high-volume incumbents can make a product unattractive even when demand is strong.

Review barrier: Products with entrenched listings and thousands of reviews are hard to enter unless there is a clear offer, price, bundle, supply, or differentiation advantage.

Brand risk: Brand approval may be required. Unauthorized trademark use is blocked.

Category risk: Some categories require approval or have tighter attribute and document rules. The adapter does not assume eligibility.

Hazmat risk: Cleaning chemicals, aerosols, batteries, and related products can require hazmat review before sale.

GTIN risk: A new ASIN usually needs product identifiers or an approved exemption path.

Invoice risk: Some categories and brands can require supplier invoices before selling.

Supply risk: Unclear supply, no invoice, unstable replenishment, or weak cost data reduce readiness.

## Amazon Vs eBay

eBay is listing-first. The seller usually creates an individual listing with its own title, images, description, pricing, and shipping choices.

Amazon is catalog-first. The seller must first decide whether to sell on an existing ASIN or create a new ASIN. Amazon also has stronger catalog identity, Buy Box, category, brand, hazmat, invoice, and GTIN gates. A strong eBay candidate can still be blocked on Amazon until these gates are resolved.

## Reuse Of The Common Core

This adapter follows the same local Seller OS pattern used by the eBay track:

- sanitized fixture input
- pure scoring module
- dry-run CLI
- static guardrails against external writes
- bounded scores from 0 to 100
- explicit next-loop summary
- tests that prove no marketplace publication occurred

The Amazon-specific layer changes the domain gates: ASIN strategy, Buy Box difficulty, review barrier, category/brand approval, GTIN, hazmat, invoice, and Seller Central readiness.

## Why No Amazon API In This Loop

Loop 149A is a modeling and readiness loop. Account access, API authorization, category eligibility, and operational credentials are not prerequisites for understanding the decision framework. Avoiding Amazon integration keeps the project moving without risking accidental catalog writes or premature account actions.

## Why Nothing Is Published

The goal is to decide what would be worth preparing, not to sell yet. Publication requires account setup, category gates, brand authorization where applicable, invoices where needed, compliant images, product identifiers, and final human review. None of those are executed here.

## Next Step

149B - Amazon Seller Account Setup Checklist + Category Gate.
