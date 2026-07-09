# Luna Portex Amazon Catalog Matcher V1

## Why

LOOP 149C creates a local dry-run matcher between Luna Portex supplier products and sanitized Amazon catalog candidates. The goal is to decide whether a product likely already exists as an Amazon ASIN before any restriction gate, listing prep, or new ASIN workflow.

This loop does not connect to Amazon, does not use SP-API, does not scrape, does not write to Seller Central, and does not publish anything.

## Current State

Amazon Track now has:

- 149A Product Winner Metrics + Listing Readiness
- 149B Seller Account Setup + Category Gate
- 149C Catalog Matcher

The matcher starts from sanitized Luna Portex product facts and sanitized Amazon candidate data only.

## Luna Portex Does Not Need To Have ASIN

Luna Portex is a supplier. Amazon ASINs belong to the Amazon catalog, not to the supplier. A supplier product can be matched to Amazon by identifiers such as UPC, GTIN, part number, model number, manufacturer part number, brand, size, pack count, color, category, and title.

Missing ASIN is not a blocker. It means IMNOVA OS must search and compare carefully before deciding whether to sell on an existing ASIN or treat the product as a new ASIN candidate.

## Identifier Differences

Supplier SKU identifies the product inside Luna Portex or IMNOVA workflows. It is not an Amazon catalog identifier.

Part number is a product or manufacturer part identifier. Model number is often the same as part number for packaged goods. MPN means manufacturer part number and should be treated as a comparable model or part identifier.

UPC, GTIN, and EAN are product identifiers that can create the strongest catalog match.

ASIN is Amazon's catalog identifier. It should not be invented, guessed, or inferred from title similarity alone.

## Matching Without ASIN

The matcher compares:

- UPC, GTIN, or EAN
- brand
- model number
- part number
- manufacturer part number or MPN
- title
- product type
- size
- pack count
- color
- dimensions
- category
- future image similarity placeholder

## Match Levels

UPC or GTIN exact match is the strongest signal.

Brand plus model or part number is a strong signal.

Brand plus model and size is also strong.

Title plus size is possible research evidence, not approval.

Weak title-only match cannot recommend automatic sale on an existing ASIN.

No match means the product may need GTIN/exemption, more data, or a new ASIN candidate path.

Conflicting match means multiple candidates are strong enough to require human review.

## DM0628N Example

Luna Portex product:

- Supplier SKU: `luna-portex:first_real_mini_scan:dm0628n`
- Brand: Glisten
- Part Number: DM0628N
- Model Number: DM0628N
- MPN: DM0628N
- Size: 28 oz
- Product type: dishwasher cleaner / detergent booster

If a sanitized Amazon candidate has the same brand, the same model or part number, and the same size, the matcher can produce a strong match even without UPC or ASIN from Luna Portex. Missing UPC still creates a warning because future restriction and GTIN gates need to resolve it.

## Duplicate ASIN Risk

Amazon is catalog-first. Creating a new ASIN for a product that already exists can create duplicate catalog risk. Strong existing-catalog evidence should route to existing ASIN review, not immediate new ASIN creation.

## Wrong ASIN Risk

Selling on a similar ASIN is unsafe when brand, model, size, pack count, color, product type, or category conflict. A similar title is not enough. Wrong ASIN risk requires human review and blocks listing prep.

## SELL_ON_EXISTING_ASIN

`SELL_ON_EXISTING_ASIN` means the local matcher found strong evidence that the product may belong on an existing sanitized ASIN candidate. It does not mean real Seller Central approval, category approval, brand approval, offer eligibility, or publication readiness.

## CREATE_NEW_ASIN_CANDIDATE

`CREATE_NEW_ASIN_CANDIDATE` means the local matcher did not find a likely existing ASIN and the product has enough identifiers to research a new catalog path. It still requires GTIN/exemption, brand decision, category gate, content, images, and human review.

## Data Needed From Luna Portex

- supplier SKU
- product title
- brand
- part number
- model number
- manufacturer part number
- UPC, GTIN, or EAN if available
- product type
- size
- pack count
- color
- dimensions
- category
- product image package later

## Data Needed From Amazon Later

Later SP-API or Seller Central review may provide real catalog search, ASIN details, restrictions, brand gates, GTIN requirements, variation structure, offer eligibility, and category attributes. LOOP 149C does not use those live sources.

## Why No Amazon API Or SP-API In LOOP 149C

The goal is to build and test local matching rules before credentials or live catalog access. This prevents accidental Seller Central actions, live search assumptions, scraping, publication, or duplicate ASIN creation.

## How This Feeds LOOP 149D

LOOP 149D is Amazon Restriction / Category / Brand / GTIN Gate. The matcher sends each product forward with match type, confidence, ASIN strategy recommendation, duplicate ASIN risk, wrong ASIN risk, warnings, blocked reasons, and human review requirement.

## Safety Boundaries

- No Production touch
- No Staging DB write
- No Amazon API
- No Selling Partner API
- No Seller Central mutation
- No publication
- No scraper
- No eBay Production API
- No real WhatsApp send
- No OpenAI
- No image generation
- No uploads
- No downloads
- No migrations
- No environment file changes
- No credential material

## Definition Of Done

- Fixture includes at least three Luna Portex products.
- DM0628N uses part number, model number, and MPN as strong match signals.
- CLI prints numeric summary.
- Tests prove match confidence, match type, strategy, risks, no live integrations, and next loop.
- No product is approved for real listing.

## Human Explanation Rule

Every match must explain why it can or cannot proceed. Human review should see whether the issue is missing UPC, weak title-only match, conflicting ASIN candidates, wrong category, size mismatch, duplicate ASIN risk, or need for GTIN/exemption.

## Next Step

149D — Amazon Restriction / Category / Brand / GTIN Gate.
