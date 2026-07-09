# Amazon Fees + Profit Guard + ROI V1

## Why

LOOP 149E adds a local dry-run profit guard for Amazon candidates before IMNOVA OS spends effort on listing packages, pricing operations, or SP-API integration. A product can have a strong ASIN match and still be a bad Amazon product if the supplier cost, Amazon fees, fulfillment, ads, returns, and prep costs erase the margin.

## Current state

Amazon Track is active after LOOP 149A, 149B, 149C, and 149D. Production remains frozen and Core-only. This loop is local only and consumes sanitized restriction-gate style inputs. It does not connect to Amazon, Seller Central, SP-API, eBay, WhatsApp, OpenAI, scrapers, Production, or Staging DB.

## Why a product that sells may not make money

Amazon demand is not enough. A product can move units and still lose money after referral fees, fulfillment, packaging, shipping, advertising, returns, and supplier cost. The profit guard prevents IMNOVA OS from solving restrictions for products that do not justify the work financially.

## What Fees + Profit Guard + ROI Calculates

The model calculates estimated supplier cost, sale price, referral fee, FBA fee or FBM cost, prep and packaging, shipping, advertising reserve, return reserve, landed cost, total cost, net profit, net margin percent, ROI percent, break-even price, minimum profitable price, and a recommended price range.

## Revenue, Gross Profit, Net Profit, Margin, and ROI

Revenue is the estimated Amazon sale price. Gross profit is not enough for Amazon because fulfillment and reserves matter. Net profit is sale price minus all modeled costs. Net margin percent is net profit divided by sale price. ROI percent is net profit divided by supplier cost.

## Costs Considered

- Supplier cost from Luna Portex or a sanitized estimate.
- Amazon referral fee estimate from configurable fixture rates.
- FBA fee estimate where dimensions and weight are known enough for local modeling.
- FBM cost estimate where merchant fulfillment is plausible.
- Prep and packaging cost.
- Shipping or inbound handling estimate.
- Advertising reserve.
- Return reserve.

## Break-Even Price

Break-even price is the price that covers product cost, fulfillment, prep, shipping, referral fee, advertising reserve, and return reserve. It is a floor for research, not an official Amazon price.

## Minimum Profitable Price

Minimum profitable price is higher than break-even and includes the configured minimum margin guard. If the estimated Amazon sale price is below this number, the product is flagged as too competitive or low margin.

## Recommended Price Range

The adapter returns a range instead of a rigid price. The lower bound respects the minimum profitable price. The upper bound leaves room for manual market review and future fee confirmation.

## Price War Risk

Price war risk increases when the estimated net margin is too close to the minimum guardrail or below it. A product with thin margin can be watchlisted or rejected even when the catalog match is strong.

## Profit Guard Decisions

Allowed decisions are `PROFITABLE_CONTINUE`, `LOW_MARGIN_WATCHLIST`, `REJECT_LOW_ROI`, `REJECT_NEGATIVE_PROFIT`, `NEED_REAL_AMAZON_FEES`, `NEED_FBA_FBM_DECISION`, `PRICE_TOO_COMPETITIVE`, `BLOCKED_BY_RESTRICTION_GATE`, and `CONTINUE_RESEARCH_ONLY`.

## DM0628N Example

DM0628N can proceed to fees and ROI research because LOOP 149D allowed financial analysis. It still cannot proceed to listing package because hazmat and chemical review remain unresolved. Positive ROI does not override Amazon restriction gates.

## Why ROI Can Advance While Listing Package Stays Blocked

Fees research helps decide whether restrictions are worth solving. Listing package work requires a cleaner gate. A product can be worth watching financially while still blocked from listing preparation.

## Real Fees Later

The fixture uses configurable estimates only. Real Amazon fees will later come from Seller Central or SP-API fee previews after account, category, brand, GTIN, and restriction gates are ready.

## Why No Amazon API or SP-API in LOOP 149E

This loop exists before live Amazon integration. It tests the local decision model and keeps the safety boundary clear: no credentials, no tokens, no Seller Central automation, no listing creation, and no publication.

## How This Feeds LOOP 149F

LOOP 149F will use the output to decide whether a candidate should sell on an existing ASIN, remain a new ASIN candidate, require more data, stay on watchlist, or be rejected before further Amazon work.

## Safety Boundaries

- No Production writes.
- No Staging DB writes.
- No Amazon API or SP-API.
- No Seller Central write.
- No scraper.
- No publication.
- No eBay Production API.
- No WhatsApp real send.
- No OpenAI or image generation.
- No `.env` changes, secrets, tokens, dumps, backups, uploads, downloads, or migrations.

## Definition of Done

The loop is done when the local module, fixture, dry-run CLI, tests, and documentation exist; the dry-run prints the expected summary; the safety flags remain false for external systems; and TypeScript plus requested regression tests pass.

## Human Explanation Rule

When reporting a product, explain margin in plain language: estimated sale price, total cost, net profit, margin, ROI, restriction status, and why the product can or cannot move forward.

## Next Step

149F — Amazon Existing ASIN vs New ASIN Decision Engine.
