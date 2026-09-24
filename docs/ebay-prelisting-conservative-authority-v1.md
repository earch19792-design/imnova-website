# eBay US no-store prelisting conservative authority (local, not deployed)

The runtime fee reader uses `ebay-us-no-store-fvf-official-capture-v1.json`,
not a live Help-page scrape. The capture is the normalized basic FVF table
from the OWNER-identified official eBay Help page, not raw HTML. Its SHA-256
digest is pinned independently in the fee reader. It must be manually
revalidated against the official page before `revalidateAfter`; if the page
changes, a reviewer must update the normalized table, digest, version and
review timestamp together. The capture has no invented effective date.

The OWNER-approved account-scoped policy is
`ebay-prelisting-owner-conservative-fee-policy-v1.json`. Exact applicable
Service Metrics `PROVEN_ZERO` uses zero; exact applicable 5%/6% evidence uses
the proven rate. An unresolved or `NO_DATA` evaluation uses the explicit 6%
`CONSERVATIVE_BOUND` on the known pre-tax fee basis. It is a profitability
reserve, never a claim about the current or realized eBay surcharge. The
Health & Beauty 0.00% past-window observation does not itself prove a current
exact SKU surcharge. Current Above Standard seller-level evidence proves zero
only while its short-lived attestation remains fresh.

The OWNER separately approved a 2.5% `BUYER_DEPENDENT_FEE_RESERVE_V1` on the
known pre-tax sale basis. It is not a buyer sales-tax estimate or realized
fee. It covers modeled domestic buyer-dependent fee-basis uncertainty,
including tax-driven FVF and the possible $10 fixed-fee threshold change;
neither is added again as a separate reserve. It does not prove a universal
bound for every destination or international sale.

For a proven pre-tax sale basis `B`, the buyer-dependent reserve is
`ceil_cent(B × 0.025)`. The Service Metrics amount is `0`, an exact current
applicable rate, or `ceil_cent(B × 0.06)` under the OWNER bound. The official
category FVF and per-order fee are evaluated at `B` for every floor candidate.
The buyer-dependent reserve is added once. Buyer sales tax itself is **not**
deducted as a seller cost, and the modeled fee is never labeled realized.

The scenario-bound economics formula is:

`netProfit = salePrice - productCost - supplierShippingQty1 -
conservativeEbayFees - promotedListings - returnsReserve -
otherExplicitCosts - fulfillmentCost`

`netMargin = netProfit / salePrice`; `ROI = netProfit / productCost`.
The floor evaluates the official fee policy again at every cent through the
target price, including the $10 order-fee threshold, and fails closed above
the bounded $500 search limit. It cannot authorize a price without exact
SKU category authority, explicit fee-basis inputs, known insertion/upgrade
fees, the OWNER fee-reserve policy, domestic-scenario proof, current seller level,
shipping/fulfillment authority, and market pricing authority. The existing
final-price evaluator remains unchanged.

The two official category-page IDs in the canary probe are *not* listing SKU
bindings: `179239` is a parent of Men's Sunglasses (`79720`), while `11848`
is the Women's Fragrances page. ITEM5674's queue recommendation is `180345`
(Fragrances) and is explicitly `CATEGORY_NOT_CONFIRMED`. An exact eBay draft
category ID and authenticated Taxonomy ancestry bound to each SKU remain
required. An OWNER-confirmed manual editor receipt must match the entire
unique official leaf path exactly. OWNER has now attested the full five-node
ITEM-8058 editor path in a continuous video, correcting the earlier parent
path ambiguity. The video artifact/capture timestamp and current authenticated
Taxonomy tree version/unique leaf response are not available in this workspace;
the public-page ID alone still cannot certify its numeric binding. No
marketplace write is permitted to obtain it.
