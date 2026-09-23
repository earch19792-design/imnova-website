# Commercial Trace final-price authority v1 (local, not deployed)

Commercial Trace's existing `RECOMMENDED_PRICE` and `ECONOMICS` are advisory.
Only `ECONOMICS_AUTHORITY.priceAuthorized === true` may populate
`FINAL_AUTHORIZED_PRICE`. The versioned account policy in
`commercial-trace-owner-price-policy-v1.json` records the OWNER's explicit
2026-09-23 approval: USD, $5 minimum net profit, 20% minimum net margin,
30% minimum ROI, 4% returns reserve, Promoted Listings opt-in with an explicit
NOT_APPLICABLE default, and other costs NOT_APPLICABLE unless discovered.
Its approval statement digest and full policy digest are checked at runtime.
A malformed, wrong-
account, premature, expired or otherwise unverified policy remains UNKNOWN.
No 5% advertising rate is implicit; an exact candidate opt-in needs its own
fresh, product-bound rate evidence.

The evaluator requires exact current Product Truth cost, exact fresh Luna
qty1 shipping receipt, official pre-sale fee authority bound to the exact
account/category/package revision/SKU/price, explicit OWNER account policy for
promotion, returns, other costs and profitability gates, product-specific
fulfillment review and allowed-service cost, and sufficient SOLD-based market
authority. Active-market-only testable pricing cannot authorize a final price.
Unknown, stale, estimated and cross-identity inputs fail closed.

The read-only fee handoff now checks an already-existing package against the
exact account, Luna identity, category, price, SKU and current package
revision. It never creates a listing package or fee binding. A new candidate
without that package remains MISSING. The pre-sale fee quote at the target
price does **not** prove fees at lower
prices. An official maximum fee over the interval from zero to that target is
required before an `economicFloor` is calculated. No current producer supplies
this interval bound for an unlisted Commercial Trace candidate. An actual
post-sale fee is a different authority and cannot substitute for it.

For a fully proven target: `totalCosts = productCost + supplierShippingQty1 +
ebayVariableFee + ebayFixedFee + otherSellerFees + promotedListingsCost +
returnsReserve + otherExplicitCosts + fulfillmentCost`.
`netProfit = salePrice - totalCosts`; `netMarginPercent =
100 * netProfit / salePrice`; `roiPercent = 100 * netProfit / productCost`.
The ROI basis is the existing Seller OS product-cost basis. The floor is the
ceiling-to-cent of the maximum price needed to pass the configured profit,
margin and ROI gates, using the official fee interval maximum, fixed costs and
explicit percentage reserves. It is distinct from the SOLD-market median
target. An exact target passing all gates is still required.

This local contract does not create an eBay fee quote, an interval-wide fee
maximum or product-specific fulfillment evidence. Product-text hazmat guards
and account shipping policies are insufficient to mark a product UNRESTRICTED;
the deployed candidate reader therefore leaves fulfillment UNKNOWN. The
positive unit test uses synthetic
proofs and is not production certification. Do not deploy until those real
authorities, their durable readers, an exact package binding, and bounded
preprod canaries have been demonstrated. No migration is included.
