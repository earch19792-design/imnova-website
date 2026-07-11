# EBAY-RESUME-B2A-LUNA-SCAN-MATCH-CONFIRMATION

## Strategic correction

The previous route treated `NEED_REAL_LUNA_CATALOG_FILE` as the main blocker. That is not the intended selling strategy. eBay defines the winning product; Luna Portex is not asked to choose it. The corrected blocker is `NEED_LUNA_SCAN_MATCH_CONFIRMATION`.

## Why a real Luna catalog is not the main blocker

Requiring a full supplier catalog or warehouse consultation before every candidate adds manual dependency and reverses the market-first strategy. The existing Luna scan is sufficient to surface similar or available candidates for comparison. No manual product-by-product search should be the normal workflow.

## Source responsibilities

- `EBAY_MARKET_OBSERVED`: eBay comparables define the winning product pattern, keywords, title, category, item specifics, description structure, price recommendation and pack wording.
- `LUNA_SCAN_OBSERVED`: Luna Scan supplies candidate name, observed SKU when present, color, material, pack/availability signals and image reference when present.
- `HUMAN_WHATSAPP_CONFIRMED`: the human answers the narrow question: is the scan candidate the same product as the eBay winner?

Luna Scan does not decide which product is a winner. eBay market evidence does not prove supplier cost or stock. Human confirmation proves product identity, not supplier inventory.

## Human WhatsApp confirmation card

The module builds a logical card showing the eBay winner and best Luna Scan candidate with a safe comparison prompt. `HUMAN_CONFIRMED_SAME_PRODUCT` maps to `CONFIRMED_SAME_PRODUCT`; `HUMAN_REJECTED_NOT_SAME_PRODUCT` maps to rejection. This loop sends no real WhatsApp message.

## Listing fields versus supplier operational fields

Once the human confirms product identity, eBay market-observed data may complete title, category, item specifics, an original description, price recommendation and pack wording for a controlled draft/unpublished package. Missing weight or dimensions may be represented only as `EBAY_MARKET_OBSERVED_WITH_LOW_CONFIDENCE` and remain `UNKNOWN`.

Supplier SKU, cost, stock and image remain `LUNA_SCAN_OBSERVED` only when present. Missing cost or stock is never invented; it remains `UNKNOWN_FROM_SUPPLIER` behind `LOW_CONFIDENCE_GUARD`. An eBay image can be a review reference only and is never copied as a supplier image.

## Routes

- `NEED_LUNA_SCAN_MATCH_CONFIRMATION`: strong safe scan match exists, but human confirmation is pending or needs review.
- `EBAY-RESUME-B2-RUN`: strong safe match plus exact positive human confirmation; only a controlled draft/unpublished package may be prepared.
- `NEED_LUNA_SCAN_REMATCH`: human rejected the candidate or its score is too low.
- `EBAY-RESUME-HOLD`: selected candidate has high-risk signals.

`canPublish` is always false. B2-RUN readiness does not authorize a draft write, listing, offer or publication in this loop. Real publication remains behind later explicit human approval.

## Connection to LOOP 152

After a real listing exists, LOOP 152 can continue using Luna Scan and the previously modeled stock/price guards for monitoring. Unknown or low-confidence supplier fields remain alerts and manual approval inputs; they are not silently promoted to confirmed inventory facts.

## Safety boundaries

- No real catalog request, warehouse consultation or manual supplier search.
- No eBay API, OAuth, database write, draft, listing, offer or publication.
- No real WhatsApp send, scraper or image generation.
- No tokens, secrets, environment files or full warehouse address.
- No Amazon or old eBay sandbox draft work mixed in.

## Definition of Done

The loop applies the route correction, scores four scan candidate classes, builds the logical human confirmation card, preserves field-level provenance, guards unknown supplier facts, supports pending/positive/negative simulations, keeps publication blocked and passes its regression suite.

## Human explanation rule

Reports must say plainly: eBay identifies what should sell, Luna Scan finds a possible physical match, and the human confirms whether it is the same product. No source is allowed to claim facts owned by another source.
