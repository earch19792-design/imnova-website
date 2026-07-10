# EBAY-RESUME-B2A-LUNA-MATCH — Luna Portex Match Enrichment

## Why

B2A-RUN confirmed real active eBay comparables, but market evidence alone does not prove that Luna Portex carries the same product or a viable equivalent. This loop separates market observations from supplier facts before any controlled draft execution.

## Current state

The sanitized B2A-RUN result analyzed 40 official read-only eBay comparables. Keywords, title pattern, price range, category and item-specific signals were confirmed. Sold/completed data was unavailable under the current endpoint or scope. No Luna match was confirmed, so the route correctly stopped at `NEED_LUNA_MATCH`.

Observed pack signals were `[20, 6, 0, 2, 10, 1]`. Zero is not a valid pack size. It means a generic pack/bundle word was observed without a reliable positive quantity and is normalized as `NO_PACK_SIGNAL`; it is removed before dominant-pack or availability calculations.

## Market-observed data versus supplier-confirmed data

`marketObservedData` contains what eBay comparables suggest: demand language, title structure, price range, category, item specifics and pack signals. It is evidence for a selling hypothesis, not supplier truth.

`supplierConfirmedData` must come from Luna Portex and independently confirm SKU, cost, stock, available pack sizes, color, material, weight, dimensions and a real authorized product image. eBay may suggest these fields but cannot substitute for Luna confirmation.

## Matching Luna Portex

The framework builds a supplier query from the generic product name, safe keywords, category and specifics. A match is sufficient only when Luna identifies the product or viable equivalent with high confidence and provides the operational facts required for fulfillment.

The initial dry-run deliberately leaves these values at `runtime_required`. It does not invent supplier data and therefore cannot proceed to B2-RUN.

## Dimensions and shipping

Dimensions observed in eBay listings are retained only as `marketObservedDimensions`. They may help identify inconsistencies or guide a supplier request, but they never become `supplierConfirmedDimensions`. Missing Luna weight or dimensions routes to `NEED_SUPPLIER_DIMENSIONS` because shipping cost and margin cannot be trusted without them.

## Image readiness

An eBay competitor image is never copied. Luna must confirm a real, authorized product image. Missing image confirmation routes to `NEED_SUPPLIER_IMAGE`. This loop performs no image generation.

## Pack availability and margin

The normalized market sizes are compared with Luna's confirmed pack sizes and stock. A recommended pack requires enough physical units, positive estimated margin and manageable shipping. Missing quantity or pack availability routes to `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`.

## Route decisions

- `NEED_LUNA_MATCH`: no sufficiently confident Luna product or equivalent.
- `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`: product matches, but pack availability or stock is unknown or insufficient.
- `NEED_SUPPLIER_DIMENSIONS`: Luna weight or dimensions are missing.
- `NEED_SUPPLIER_IMAGE`: no real authorized supplier image is confirmed.
- `NEED_HUMAN_APPROVAL`: operational data is complete but Ernesto has not approved the controlled next step.
- `EBAY-RESUME-HOLD`: account/product risk, margin or shipping fails.
- `EBAY-RESUME-B2-RUN`: market data, high-confidence Luna match, SKU, cost, stock, pack, weight, dimensions, image, positive margin, shipping readiness and human approval are all complete.

## Why publication remains blocked

`canPublish` is always false. This loop only enriches and validates data; it creates no draft, inventory item, offer, listing or publication.

## Safety boundaries

- Local dry-run only; no eBay API or OAuth.
- No eBay or database writes.
- No scraper, image generation, token handling or secret storage.
- No competitor title, description or image copying.
- No Amazon track or old eBay sandbox draft track mixing.
- Only the safe warehouse alias is versioned; no complete street address.

## Definition of Done

The framework normalizes invalid pack signals, preserves the market/supplier boundary, identifies missing Luna facts, enforces route precedence, blocks publication and passes its local regression and safety suite.

## Human explanation rule

Reports must explain that eBay shows what buyers and sellers are doing, while Luna must prove what can actually be sourced and fulfilled. A high market signal never overrides missing supplier evidence or human approval.

## Next step

For the initial fixture, the next route is `NEED_LUNA_MATCH`: confirm the Luna product or viable equivalent and obtain SKU, cost, stock, pack availability, weight, dimensions and an authorized image. Only a complete, low-risk, positive-margin result may advance to `EBAY-RESUME-B2-RUN`.
