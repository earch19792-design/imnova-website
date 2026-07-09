# Amazon Seller Account Setup + Category Gate V1

## Why

LOOP 149B protects IMNOVA OS before any Amazon selling workflow. Amazon can block a seller account or product because identity, bank, tax, marketplace setup, category eligibility, brand approval, GTIN, hazmat, electrical compliance, chemical compliance, claims, or invoice evidence is incomplete.

This loop creates a local dry-run gate. It does not connect to Amazon, does not use the Selling Partner API, does not mutate Seller Central, and does not publish anything.

## Current State

Amazon Track started in LOOP 149A with Product Winner Metrics + Listing Readiness. That model scores product opportunity and readiness. LOOP 149B adds the seller account and category gate that must sit before catalog matching or listing prep.

The current fixture simulates one partially ready Amazon Seller account targeting the USA marketplace and three sanitized product candidates:

- cleaning or chemical
- electrical
- household simple

## How Amazon Seller Account Setup Works

Amazon Seller setup is more than opening an account. A professional operating path typically needs identity verification, business details, marketplace target, tax interview, bank account, charge method, phone, address, return address, seller profile, two-step verification, and account health review.

The professional plan is recommended when repeat selling, catalog work, offer management, and operating discipline are expected. The plan choice still requires human confirmation because fees and account status matter.

## Account Ready Does Not Mean Product Approved

A seller account can be ready while a product is still blocked. Category restrictions, brand approval, product identifiers, hazmat review, electrical safety, chemical compliance, invoice requirements, and restricted claims are product-level gates.

The reverse is also true: a low-risk product should not move to real listing prep if identity, tax, or bank readiness is incomplete.

## Account Readiness Vs Category Gate

Account readiness evaluates whether the seller account is operationally ready for research or listing prep.

Category gate evaluates whether each product can continue toward Amazon catalog matching, whether human review is required, and what blocks listing prep.

LOOP 149B never declares a real category approval unless the data explicitly comes from Seller Central or human review.

## Amazon Seller Account Checklist

- Identity verification
- Business type and business information
- Marketplace target: USA
- Professional plan recommendation
- Bank account
- Charge method
- Tax interview
- Address and phone verification
- Return address
- Seller profile
- Two-step verification
- Account health baseline
- API readiness status as informational only

## Marketplace USA Gate

The USA marketplace gate confirms that the account is being evaluated for the intended marketplace. Product eligibility, required documents, category rules, shipping expectations, and compliance handling can vary by marketplace, so this loop keeps the USA target explicit.

## Tax, Bank, And Identity Readiness

Identity, tax, and bank are hard account gates. If identity is incomplete, the account is blocked by identity. If bank or tax is incomplete, the account is blocked by tax and bank readiness. A partially ready account can still support research, but it should not support live listing prep.

## Category Gate Explained

Each product receives a category gate with:

- product identity fields
- possible Amazon category
- category risk level
- likely category approval
- likely brand approval
- invoice requirement
- GTIN or exemption requirement
- hazmat review requirement
- electrical safety review requirement
- chemical compliance review requirement
- expiration or lot tracking requirement
- catalog matcher permission
- listing prep permission
- human review requirement
- blocked reasons
- warnings
- next recommended action

## Cleaning And Chemical Risk

Cleaning and chemical products can require hazmat review, safety documentation, ingredient or SDS evidence, category approval, and stronger claim controls. They should not move to listing prep until compliance and hazmat status are verified.

## Electrical Risk

Electrical products can require safety and compliance evidence. A product visible on Amazon is not enough proof that IMNOVA can sell it. Brand, category, electrical safety, model, part number, and invoice evidence must be checked.

## Household Simple Risk

Household simple products are often lower risk, but they can still need GTIN, exemption, invoice confirmation, category attributes, or brand checks. Low risk allows research to continue; it does not automatically allow listing.

## Seller Central Must Confirm Restrictions

Seller Central or human review must confirm real restrictions. Amazon search results, existing ASINs, or competitor listings are not proof that the account can sell a product or create a listing.

## What Blocks A Product Before Listing

- Account not ready for listing prep
- Category approval likely required
- Brand approval likely required
- Supplier invoice likely required
- GTIN or exemption required
- Hazmat review required
- Electrical compliance not cleared
- Chemical compliance not cleared
- Category not confirmed by Seller Central or human review
- Missing Luna Portex product data

## Data Needed From Luna Portex

- Product title
- Supplier SKU
- Part number
- Model number
- Brand
- Product type
- Possible Amazon category
- GTIN, UPC, or exemption path
- Invoice availability
- Hazmat or SDS data
- Electrical safety evidence when applicable
- Chemical compliance evidence when applicable
- Expiration or lot tracking facts when applicable

## Data Needed From Amazon Later

- Seller account verification status
- Marketplace setup state
- Category restrictions from Seller Central
- Brand approval requirements
- Product identifier requirements
- Hazmat classification result
- Category attribute requirements
- Listing policy constraints
- Offer eligibility against existing ASINs

## Why No Amazon API Or Selling Partner API In LOOP 149B

This loop is a local gate. The goal is to model the decision system and prevent premature selling actions before credentials, account status, category approvals, and human checks exist. API access belongs after account setup and category gates are clear.

## How This Feeds LOOP 149C

LOOP 149C is Luna Portex ↔ Amazon Catalog Matcher. Only products that can continue research should flow into catalog matching. Products blocked by account, category, brand, invoice, GTIN, hazmat, electrical, or chemical gates stay out of listing prep.

## Safety Boundaries

- No Production touch
- No Staging DB write
- No Amazon API
- No Selling Partner API use
- No Seller Central mutation
- No publication
- No eBay Production API
- No real WhatsApp send
- No OpenAI
- No image generation
- No uploads
- No scraper
- No downloads
- No migrations
- No environment file changes
- No credential material

## Definition Of Done

- Fixture covers one partially ready seller account and three product gates.
- Module is pure and deterministic.
- CLI prints numeric dry-run summary.
- Tests prove account readiness, category gates, safety flags, and no external integrations.
- Products are not marked category-approved without Seller Central or human review.
- Next loop is `149C`.

## Human Explanation Rule

Every blocked product must explain the reason in business language. The operator should know whether the next action is account setup, category check, brand approval, invoice request, GTIN/exemption, hazmat review, electrical review, chemical review, watchlist, or do-not-list-yet.

## Next Step

149C — Luna Portex ↔ Amazon Catalog Matcher.
