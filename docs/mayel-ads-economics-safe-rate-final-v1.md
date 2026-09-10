# Mayel economics and safe advertising rate

Mayel separates four decisions: metrics determine whether to SCALE, OPTIMIZE or run a cold-start TEST; proven unit economics determines spending capacity; OWNER policy supplies rate limits and minimum profit/margin; Mayel proposes the lowest applicable rate. Cold start does not invalidate otherwise proven economics. Ads writes remain disabled and any first canary requires a later explicit OWNER approval.

The safe spending capacity is profit before Ads less the larger of minimum profit and price times minimum margin. Capacity is rounded down to whole cents before division by the separately proven official ad fee basis. OWNER's 3–5% range never becomes the economic ceiling. Simulations distinguish SAFE, UNSAFE_PROFIT, UNSAFE_MARGIN and UNPROVEN_ECONOMICS; missing economics has `safe=null`.

The common shipping path consults the existing durable Luna Portex quote before checkout acquisition. Reuse requires exact account/listing/SKU, approved supplier product/variant linkage, destination fingerprint, currencies and source lifetime. An auxiliary 429 does not supersede a valid quote. The normal Mayel reader also projects a valid stored quote directly into economic evidence without changing its timestamp. Expired quotes remain pending and are not refreshed by copying them.

Fees retain the certified category-specific tariff and account context. Buyer sales tax is neither seller revenue nor an expense. The producer and resolved authority expose normal category fees separately from contingent fees attributable to tax, including a possible per-order threshold change. The final total still requires complete conservative monetary coverage; a known rate alone is not a monetary bound. Current official non-applicability decisions and applicable published monetary bounds fill missing adjustment inputs automatically when a complete bound basis exists. Supplied contradictory evidence is preserved for rejection.

The existing OWNER policy for other variable costs now applies to future operated listings in the same account, as requested. Its presence is independent of missing shipping or fees. An explicit newer material cost, including a stale one, prevents fallback to the older zero policy.

The commercial envelope and Impulsar ventas show price, cost, shipping, fees, profit, margin, safe ceiling, recommended rate and projected profit. Diagnostics and simulation details remain under Ver detalles. Selection considers bounded current candidates and economic uncertainty; it does not require listing 4490. Existing current metrics and scoped Quality signals feed the treatment decision. No new worker, poller, global scan, count query or marketplace write path was added.

## Physical evidence on September 10

The normal reader examined the existing 23 listings in two bounded cohorts (20 and 3), using 12 database requests and zero eBay requests. It found zero proven economic candidates. The durable shipping audit found 22 stored quotes, all older than their six-hour contract, and one missing quote (366643126310). Only three listings had fee authority heads; none provided a complete current pre-sale safe bound. Therefore no listing eligibility request or Ads preview authorizing spend was issued. The OWNER policy read physically is minRate=3, maxRate=5, minProfit=8 USD, minMargin=15%.

The implementation does not claim that tests prove a real listing's economics. Actual status remains WAITING_FOR_DATA until normal producers supply fresh shipping and complete bounded fee authority. The required 3/4/5% arithmetic is exercised with explicitly synthetic evidence in directed tests; real unproven listings return null projections and UNPROVEN_ECONOMICS.

Source: [eBay selling fees](https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822), current page checked September 10. The existing certified Ads contract was reused. Its API minimum is representation authority, not the economic ceiling. Historical actual fees never substitute for current pre-sale authority.

Validation and deployed SHA are recorded in the external closeout receipt. Production app, images, Keyword V2.1 and Quality workflows remain unchanged.
