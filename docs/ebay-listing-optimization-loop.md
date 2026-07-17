# eBay Listing Optimization Loop

`EBAY_LISTING_OPTIMIZATION_LOOP_V1` converts a Market Intelligence report and
verified product facts into a reviewable eBay listing package. It does not call
eBay, publish, create an offer, or persist approval state.

## Truth boundary

`productFacts` is the only source allowed to introduce product identity,
quantity, dimensions, weight, compatibility, use cases, identifiers and
claims. Market Intelligence influences scoring and price proposals, but cannot
introduce product claims or copy competitor descriptions.

Safe automatic corrections are limited to:

- fact-derived title;
- fact-derived plain-text description;
- non-regulatory item specifics derived directly from product facts.

Price and regulatory changes are proposals requiring human approval. Any
blocking issue caps the score at 60.

## Admin interface

Open `/admin/ebay/listing-optimization` from Seller OS. An Admin may:

- upload a complete input JSON or a Market Intelligence report;
- edit product facts and the current draft;
- inspect up to ten comparables;
- approve a title and price proposal;
- approve or reject image assets and six image prompts;
- review blocking issues, score and iteration history;
- prepare one A/B experiment at a time;
- download all six output files.

The browser state is intentionally ephemeral in V1. Starting an experiment
marks it only in the current screen and never changes eBay.

## Outputs

- `listing-draft.json`
- `listing-review.json`
- `image-brief.json`
- `experiment-plan.json`
- `optimization-history.json`
- `final-listing.md`
