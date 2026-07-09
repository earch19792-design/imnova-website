# Amazon Existing ASIN vs New ASIN Decision Engine V1

## Why

LOOP 149F decides whether a Luna Portex product should follow an existing ASIN route, a new ASIN candidate route, a manual review route, watchlist, or rejection. This is the bridge between catalog matching, restriction gates, and profit guard before Amazon listing package work.

## Current state

Amazon Track has LOOP 149A through 149E integrated in PRE/Staging. Production remains frozen and Core-only. This loop is a local dry-run only. It does not connect to Amazon, Seller Central, SP-API, scrapers, eBay Production, WhatsApp, OpenAI, Production, or Staging DB.

## Why Amazon Is Not Listed Like eBay

On eBay, sellers often create their own listing. On Amazon, a product may already exist in the shared catalog. If the exact product exists, the normal route is to sell against the existing ASIN after eligibility checks. Creating a duplicate ASIN is risky. Selling on the wrong ASIN is also risky.

## Existing ASIN vs New ASIN

An existing ASIN route means the product appears to match an Amazon catalog item strongly enough for research. It still needs Seller Central eligibility and human review before a real offer. A new ASIN route means no reliable catalog match exists, but the product may be a candidate after GTIN/exemption, brand, category, compliance, and invoice checks.

## Luna Portex Does Not Need to Bring ASIN

Luna Portex supplier data can include SKU, part number, model number, brand, size, and product title. The ASIN belongs to Amazon's catalog. IMNOVA OS uses local candidate evidence to decide route, but does not claim a real ASIN or create one in this loop.

## How 149C, 149D, and 149E Combine

LOOP 149C provides catalog match type, confidence, duplicate ASIN risk, and wrong ASIN risk. LOOP 149D provides restriction, category, brand, GTIN, hazmat, chemical, electrical, invoice, and human review gates. LOOP 149E provides net profit, margin, ROI, and profit guard decision. LOOP 149F combines them into one ASIN route decision.

## SELL_ON_EXISTING_ASIN

This means research should continue toward an existing ASIN path. It does not mean the seller is eligible, the category is approved, the brand is approved, or the listing package can be built.

## CREATE_NEW_ASIN_CANDIDATE

This means the product may need a new catalog contribution later. It requires GTIN or exemption, brand decision, category decision, compliance review, and a human check before any real creation.

## Duplicate ASIN Risk

Duplicate ASIN creation can harm the seller account and catalog quality. High duplicate risk blocks automatic new ASIN routing.

## Wrong ASIN Risk

Selling under the wrong ASIN can create customer complaints, returns, policy issues, and account health risk. Conflicting or title-only matches cannot proceed as automatic existing ASIN routes.

## GTIN / UPC / Exemption

Missing UPC or GTIN does not necessarily block selling on an existing ASIN, but it blocks automatic new ASIN creation. A new ASIN path needs a valid GTIN or a confirmed exemption.

## Brand and Category Approval

Brand and category approval cannot be assumed from local data. Seller Central or human documentation must confirm eligibility before listing.

## Seller Central Eligibility Check

Every existing ASIN path requires a manual Seller Central eligibility check before a real offer. This loop only decides the research route.

## Positive ROI Does Not Unlock Listing

Positive profit or ROI cannot override hazmat, chemical, electrical, brand, category, GTIN, invoice, or wrong-ASIN gates. DM0628N shows this: it has positive ROI, but remains blocked from listing package because hazmat and chemical checks are unresolved.

## DM0628N Example

DM0628N has strong brand/model/size evidence and points toward an existing ASIN path. Because it has cleaning/chemical and hazmat review requirements plus low margin watchlist status, it stays in manual check/watchlist and cannot move to listing package yet.

## Why No Amazon API or SP-API in LOOP 149F

This loop validates the local decision model before live integration. Real ASIN eligibility, fee previews, and restrictions will be checked later through Seller Central or SP-API only after the safety gates are ready.

## Why No ASIN, Listing, or Publication Is Created

LOOP 149F is a decision engine only. `canCreateAmazonAsin`, `canCreateAmazonListing`, and `canPublish` remain false. No Seller Central mutation or publication path is allowed.

## How This Feeds LOOP 149G

LOOP 149G can build Amazon listing packages only for candidates that pass route, eligibility, restriction, and profit checks. Candidates blocked in 149F remain research-only, watchlist, or rejected.

## Safety Boundaries

- No Production writes.
- No Staging DB writes.
- No Amazon API or SP-API.
- No Seller Central write.
- No ASIN creation.
- No listing creation.
- No scraper.
- No publication.
- No eBay Production API.
- No WhatsApp real send.
- No OpenAI or image generation.
- No `.env` changes, secrets, tokens, dumps, backups, uploads, downloads, or migrations.

## Definition of Done

The loop is done when the local module, fixture, dry-run CLI, tests, and documentation exist; dry-run prints the expected ASIN strategy summary; all external execution flags remain false; and TypeScript plus requested regression tests pass.

## Human Explanation Rule

For every product, explain route, evidence, ASIN risk, restriction status, profit status, manual review requirement, and what the human seller must verify before any listing work.

## Next Step

149G — Amazon Listing Package Builder.
