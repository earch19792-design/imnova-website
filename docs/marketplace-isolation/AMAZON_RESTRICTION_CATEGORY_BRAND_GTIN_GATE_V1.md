# Amazon Restriction Category Brand GTIN Gate V1

## Why

LOOP 149D protects IMNOVA OS after catalog matching and before fees, pricing, listing package, Seller Central, or SP-API work. A likely ASIN match does not mean the product can be sold.

## Current State

Amazon Track has 149A, 149B, and 149C integrated in PRE/Staging. LOOP 149D consumes sanitized catalog match outcomes and applies local restriction gates only.

## ASIN Match Is Not Sell Eligibility

An ASIN can exist while the account still needs category approval, brand approval, supplier invoice, GTIN or exemption, hazmat review, electrical review, chemical compliance, or human review.

Catalog match answers “what might this product be?” Sell eligibility answers “can this account sell this product under Amazon rules?” Those are separate decisions.

## What The Restriction Gate Evaluates

- Category approval
- Brand approval and IP risk
- GTIN, UPC, or exemption need
- Supplier invoice need
- Hazmat risk
- Chemical compliance risk
- Electrical compliance risk
- Claims and IP risk
- Wrong ASIN risk from catalog matcher
- Human review requirement

## Category Approval

Categories can be restricted by Amazon. This loop never declares a category approved. Seller Central or later authorized Amazon data must confirm real eligibility.

## Brand Approval And IP Risk

Brand approval requires authorization evidence. A strong brand/model match does not grant permission to sell a protected brand.

## GTIN UPC Exemption

Missing UPC or GTIN does not always block selling on an existing ASIN, but it creates a warning. Missing UPC or GTIN matters more for new ASIN candidate paths because Amazon may require product identifiers or an exemption.

## Supplier Invoice

Invoices may be required for category, brand, authenticity, or account health review. Missing invoice evidence is a gate before listing package work.

## Hazmat Risk

Sprays, aerosols, paint, chemicals, detergents, and related products can require hazmat review. Aerosol paint is high risk and blocked from listing package in this loop.

## Chemical Compliance Risk

Cleaning, detergent, freshener, and chemical products require compliance review before listing prep.

## Electrical Compliance Risk

Electrical products, outlet adapters, power taps, and similar items require safety review before listing package work.

## Claims And IP Risk

Unconfirmed claims, protected brand terms, unauthorized trademark use, or IP uncertainty require human review.

## DM0628N Example

DM0628N has a strong catalog match for Glisten Dishwasher Detergent Booster & Freshener 28 oz. The result can continue research, but it is not approved for listing package because UPC/GTIN is missing and cleaning or chemical compliance must be reviewed.

## Electrical Example

GG-16000TSM has an electrical product type and a conflicting catalog match. It requires electrical safety review, human review, invoice review, and cannot move to listing package.

## Aerosol Hazmat Example

The Rust-Oleum spray paint sample is aerosol and paint. It has high hazmat risk, category/brand risk, missing GTIN, and invoice need. It is blocked from listing package.

## Seller Central Confirmation

Seller Central must confirm real restrictions before any listing or selling workflow. This loop is local and advisory only.

## What Blocks Listing Package

- Category approval likely required
- Brand approval likely required
- Supplier invoice likely required
- GTIN or exemption required
- Hazmat review required
- Chemical compliance review required
- Electrical safety review required
- Conflicting catalog match
- High wrong ASIN risk
- Human review not complete

## Data Needed From Luna Portex

Supplier SKU, brand, title, model number, part number, MPN, UPC/GTIN, invoice availability, product type, category, SDS or hazmat facts, electrical safety evidence, and claim support.

## Data Needed Later From Amazon

Seller Central and later authorized Amazon data may provide category restrictions, brand gates, GTIN requirements, hazmat status, offer eligibility, ASIN restrictions, and compliance attributes.

## Why No Amazon API Or SP-API In LOOP 149D

This loop builds the local decision framework before live account access. It avoids accidental external writes, publication, scraping, or false approval claims.

## How This Feeds LOOP 149E

Only candidates allowed by this gate can move to Amazon Fees + Profit Guard + ROI. Blocked products remain in research, watchlist, or reject states.

## Safety Boundaries

- No Production touch
- No Staging DB write
- No Amazon API
- No Selling Partner API
- No Seller Central mutation
- No scraper
- No publication
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

- Three sanitized catalog matches are assessed.
- DM0628N, electrical, and aerosol examples are covered.
- CLI prints numeric summary.
- Tests prove risk gates, blockers, no live integrations, and next loop.
- No product is approved for real listing or publication.

## Human Explanation Rule

Every assessment must explain the blocker or next action in business language before any operator moves toward pricing, listing package, or Seller Central.

## Next Step

149E — Amazon Fees + Profit Guard + ROI.
