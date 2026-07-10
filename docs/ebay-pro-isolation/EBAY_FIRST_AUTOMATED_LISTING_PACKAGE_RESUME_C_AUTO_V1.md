# EBAY-RESUME-C-AUTO — First Automated Listing Package from Benchmark

## Why

EBAY-RESUME-A5 confirmed that Seller Hub is accessible and that the official route can return to controlled automation. C-AUTO turns benchmark and winner-pipeline evidence into a complete local listing package for human review. It does not interact with an eBay account.

## Current state

- Store: ShopEliteCart.
- Marketplace target: eBay US.
- Safe warehouse reference: `LUNA_PORTEX_BOCA_RATON`, Boca Raton, FL 33487, US.
- The full warehouse street address is not stored in versioned files.
- Seller Hub access, ship-from configuration, return-address configuration, payout unlock modeling, and business-policy unlock modeling come from integrated A5.
- All candidate and benchmark data in this loop is local and sanitized.

## Official route after A5

1. EBAY-RESUME-C-AUTO — first automated listing package from benchmark.
2. EBAY-RESUME-B2 — gated eBay draft or unpublished-offer builder.
3. LOOP 150 — first human-approved real listing.
4. LOOP 151 — Seller OS dashboard.
5. LOOP 152 — active listing monitor, Luna scan, stock guard, and alerts.
6. Safe self-improvement only after selling and operating.

## What an automated listing package means

The package is a review artifact. It combines candidate identity, benchmark evidence, winner score, risk, title, price, margin, category, specifics, description, image requirements, policy recommendations, a payload preview, and an approval checklist. It is not a draft, offer, listing, or publication.

## Benchmark, winner score, and candidate review

The benchmark supplies aggregate sold-price ranges, demand samples, sell-through signals, and keyword patterns. Winner score ranks candidates, but risk has priority over raw demand. Candidate review then checks product sensitivity, brand and intellectual-property exposure, handling, missing data, and image authorization.

The framework does not copy exact titles, descriptions, or competitor images. Benchmark evidence informs patterns, keywords, and pricing only. Original wording and authorized product imagery remain mandatory.

## How the low-risk product is selected

The first candidate must be manageable, non-medical, non-supplement, non-aerosol, battery-free, non-hazardous, and free of apparent restricted-brand or VERO/IP risk. It also needs positive estimated margin, complete critical item specifics, a clear category, and an authorized product image available for Ernesto to approve.

The sample recommendation is a compact unbranded cable-organizer multipack. A fragile glass container stays on the watchlist. A branded aerosol is rejected even when its demand score looks attractive, because compliance and intellectual-property safety override demand.

## What is automated

- An original title based on product facts and benchmark keyword patterns.
- Buy It Now price and estimated margin.
- Honest description without medical claims or unsupported promises.
- Known and missing item specifics.
- Suggested category.
- Authorized-image checklist and required views.
- Shipping, return, and managed-payment recommendations.
- Non-executable payload preview.
- Human approval checklist.

## What must not be automated yet

No account access, marketplace request, OAuth action, credential handling, policy assignment, draft creation, offer creation, listing creation, publication, inventory mutation, image generation, or real message is allowed. Exact category and policy identifiers remain subject to later gated verification and human approval.

## Why product images are not generated or copied

Buyers must see the real item and packaging. A synthetic or competitor-owned image could misrepresent the product or create intellectual-property risk. This loop only records the required shots and whether an authorized source is available; Ernesto must verify the actual image later.

## Luna Portex warehouse handling

Versioned data uses the safe alias `LUNA_PORTEX_BOCA_RATON` plus city, state, postal code, and country. Sensitive street-level information belongs only in the manually configured Seller Hub account and never in this package.

## Why publication is always disabled

The output is decision support, not marketplace execution. Every candidate has `canPublish: false`, even the selected low-risk candidate. Ernesto must approve product identity, inventory, images, category, specifics, price, margin, policies, and risk before a later gated builder can be considered.

## Route decisions

Advance to EBAY-RESUME-B2 only when a low-risk candidate has positive estimated margin, complete critical specifics, an authorized image available, and a complete package for human review.

Stay in `NEED_PRODUCT_CANDIDATE_DATA` when no low-risk complete candidate exists, an authorized image is missing, critical specifics are missing, or margin evidence is insufficient.

Move to `EBAY-RESUME-HOLD` when account risk appears or a sensitive account issue must be resolved before any listing workflow.

## Safety boundaries

- Production and main remain off limits.
- There are no Staging database writes or Supabase operations.
- There is no real eBay API, OAuth, credential, draft, listing, offer, or publication activity.
- There is no image generation, external scraping, download, real WhatsApp send, or external AI API activity.
- Paused marketplace tracks and older local draft work remain separate.
- No secret, token, environment file, dump, backup, real image, or full warehouse street address belongs in this loop.

## Definition of Done

- At least three candidates are evaluated: low-risk recommended, medium-risk watchlist, and high-risk rejected.
- Benchmark signals and winner score explain selection without plagiarism.
- The recommended package contains title, price, positive margin, category, specifics, description, image plan, policies, payload preview, and approval checklist.
- Only a complete low-risk candidate may set `canProceedToDraftBuilder: true`.
- `canPublish` remains false for every candidate and the report.
- TypeScript, tests, dry-run, regression checks, static guardrails, and security scans pass.

## Human explanation rule

Every handoff must explain what the framework chose, why it chose it, which risks were rejected, what Ernesto still needs to approve, and why no marketplace action occurred. The explanation must be understandable to someone learning eBay, benchmark analysis, listing automation, and approval gates.

## Next step according to result

The expected safe result routes to **EBAY-RESUME-B2 — Gated eBay Draft / Unpublished Offer Builder**. That next loop may build a stronger execution gate, but it still must not publish without explicit human approval. Missing product evidence routes back to `NEED_PRODUCT_CANDIDATE_DATA`; account risk routes to `EBAY-RESUME-HOLD`.
