# Source notes

- Audience: product stakeholders.
- Question: whether the 3.6% margin alert for listing 366543596425 needs correction.
- Decision-useful answer: arithmetic is reproducible, but the result is a conservative scenario and must not be labeled as verified actual margin.
- Snapshot time: 2026-07-21T01:21:29Z.
- Source of truth for price and approved pack cost: staging tables `public.ebay_active_listings` and `public.ebay_listing_packages`.
- Formula owner: `lib/ebay/ebay-unit-economics.ts`.
- External policy sources: official eBay Selling fees and Promoted Listings documentation.
- Chart map: the scenario section uses one horizontal bar chart (`scenario` → `estimated_margin_rate`) to compare four long-label assumption scenarios. It uses a single blue-root palette without a redundant legend and keeps exact values in the adjacent audit table.
- Required structure mapping: title, Executive Summary, reconciled findings, scenario evidence, recommendations, open questions, and caveats are all visible. Fee and advertising findings were separated to preserve single-source provenance.
- Missing decision inputs: buyer-paid shipping, actual label cost, promoted campaign status/rate, Store plan, seller performance surcharge, fee-tax basis, and completed-order fee details.
