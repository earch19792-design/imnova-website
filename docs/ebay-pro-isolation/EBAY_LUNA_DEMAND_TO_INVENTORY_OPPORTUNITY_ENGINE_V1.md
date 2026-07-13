# eBay Luna Demand-to-Inventory Opportunity Engine V1

## Outcome

This loop turns the existing single-product eBay demand review into a professional opportunity foundation that can evaluate Luna Portex inventory against official eBay read-only signals in both directions:

1. Luna-first: normalize a Luna variant, query exact eBay comparables, assess identity, economics, market evidence, supply and listing readiness.
2. eBay-first: retrieve official `BEST_SELLING` product-level signals when Buy Marketing access is available, then look for possible Luna matches that still require exact identifier confirmation.

The engine does not guarantee sales, call Browse estimates verified history, create an eBay draft, create an offer or publish a listing.

## Professional evidence language

`estimatedSoldQuantity` is an eBay estimate attached to an active listing. A single value is a cumulative snapshot and is not a recent sales window.

The engine uses these classes:

- `SINGLE_ESTIMATED_SALES_SNAPSHOT`: one observation; no recent rotation claim.
- `OBSERVED_ESTIMATED_SALES_DELTA`: non-negative change between two observations; still estimated and never verified history.
- `COUNTER_RESET_OR_RELIST_REVIEW`: the counter decreased or the observation window is invalid.
- `ACTIVE_LISTING_ONLY`: no estimated quantity was exposed.

Market-level rotation is strong enough for opportunity review only when positive observed estimated deltas appear across at least two sellers. A one-seller signal is labeled concentration, not market proof.

## Exact match hierarchy

1. Exact GTIN.
2. Exact brand plus MPN.
3. Exact eBay catalog product/EPID when available.
4. Strong non-conflicting attributes.
5. Title similarity for human review only.

Explicit GTIN, brand or MPN conflicts invalidate the comparable. Pack, size, quantity, color and variant contradictions remain guarded by the existing comparable validator and the final human identity review.

## Luna normalization

The Market Radar Luna scanner now captures variant barcode and weight fields when Luna exposes them. The mobile connector forwards barcode as GTIN and weight into the opportunity assessment.

Required long-term Luna fields are:

- supplier product and variant IDs
- SKU
- GTIN/UPC/barcode
- brand
- MPN/model
- variant, color, size and pack quantity
- supplier cost
- stock quantity and capture time
- package weight and dimensions
- authorized exact-product images
- product type, category hints and restriction signals

Catalog coverage remains partial until configured collections and total product counts are reconciled. The engine must not claim that all Luna products were scanned before that audit passes.

## Rotation snapshots

Migration `202607120002_create_ebay_luna_opportunity_observations.sql` creates two isolated internal tables:

- `ebay_market_listing_observations`
- `ebay_luna_opportunity_assessments`

The observation table stores only the minimum fields needed for deltas: candidate key, eBay item ID, seller reference, observation time, estimated quantity, total buyer price, identity score/type and evidence source. It does not store tokens, images or raw eBay payloads.

Persistence is disabled by default. Both conditions are required:

1. server variable `EBAY_MARKET_OBSERVATION_WRITES_ENABLED=true`
2. explicit authenticated request `persistObservations: true`

The required Supabase migrations are deployed and their local/remote history is
synchronized. Runtime observation persistence remains disabled by default and
still requires both gates above.

## Opportunity score and hard gates

The score is advisory and explainable:

- demand/rotation: 25%
- unit economics: 25%
- competition: 15%
- identity: 15%
- Luna supply readiness: 10%
- listing readiness: 10%

The following hard gates cannot be averaged away by a high score:

- Luna out of stock
- unknown/freshness-expired quantity
- missing exact GTIN or brand+MPN match
- missing supplier cost
- missing package weight/dimensions
- missing authorized images
- unresolved product restriction guards
- unit economics below the configured minimum

Evidence guards separately cover missing 7/30-day baseline, single-seller concentration, high seller concentration and insufficient multi-seller demand.

Default economics include:

- 15% estimated eBay fee rate
- $0.30 fixed order fee
- $6.99 outbound shipping estimate
- 4% returns reserve
- 5% promoted-listing reserve
- $5 minimum net profit
- 20% minimum net margin
- 30% minimum ROI

These values are explicit estimates and should later be replaced by confirmed category fees, actual package shipping and the seller's promotion strategy.

## Listing intelligence package

Every assessment builds a partial package while preserving missing fields:

- exact supplier identity
- professional keyword/title structure
- aggregate buyer search intent without personal data
- official category and Taxonomy aspect requirements when available
- supplier-confirmed item specifics
- comparable aspects for review only
- total-buyer-price range
- estimated unit economics and minimum profitable price
- observed shipping/returns patterns
- authorized image plan
- restriction guards and claims policy
- Inventory Mapping preview input readiness

Competitor titles and images are reference-only and are not copied.

The official Inventory Mapping request is not executed in V1. The package prepares the safe preview input and reports whether title, authorized image, product identifier and official category metadata are complete. A future preview remains a second opinion requiring human review; it is not supplier truth, a draft or a live listing.

## Official read-only gateways

The opportunity gateway uses only official GET operations for market discovery:

- Browse search and item detail
- Buy Marketing `BEST_SELLING` when authorized
- Taxonomy default tree, category suggestions and category aspects
- Marketplace Insights only when already entitled; it is not required

The batch route is:

`POST /api/admin/ebay/luna-opportunities`

It processes at most five Luna candidates and three best-selling categories per request so a single Vercel request does not attempt a full catalog scan. Larger scans must use continuation batches or a future scheduled worker.

## Automated eBay-first opportunity queue

The authenticated Admin route `/admin/ebay/opportunity-queue` turns the batch
foundation into a durable hybrid scan:

1. `market_radar_latest_variants` enumerates every currently observed Luna
   Portex variant, rather than only the dashboard Top 50.
2. Each small continuation batch queries official eBay Browse comparables and
   Taxonomy intelligence without exceeding one Vercel request budget.
3. Optional Buy Marketing `BEST_SELLING` category signals are stored and
   matched against the Luna catalog when the application is entitled.
4. Each pass stores normalized listing observations, an explainable assessment,
   the continuation cursor and a ranked opportunity queue.
5. Later passes compare cumulative estimated quantities to build conservative
   7/30-day velocity evidence. A single snapshot is never called recent sales.
6. Luna price, inventory and availability changes produce durable queue events.
   If the product is linked to an active eBay listing, out-of-stock and price-up
   changes also create an open active-listing risk.

The scan is resumable: an Admin can process five batches at a time and safely
close the page. `/api/cron/ebay-luna-opportunity-scan` continues two batches per
scheduled invocation. Vercel requires a server-only `CRON_SECRET`; optional
comma-separated category seeds can be configured in
`EBAY_LUNA_BEST_SELLING_CATEGORY_IDS`.

The daily schedule is declared in `vercel.json`. Vercel registers Cron Jobs only
from Production deployments, so Preview/Staging validates the protected route
but uses the Admin continuation button. Completing a very large first
catalog scan can still require multiple manual continuation clicks or multiple
scheduled invocations. Once completed, the next scheduled invocation starts a
new pass, providing the separated observations needed for velocity.

The queue never creates drafts, offers or listings. `ready` means ready for
human listing-package review, not authorized for publication.

## Seller performance feedback

`GET /api/admin/ebay/seller-performance` provides a read-only foundation for the seller's own Traffic Report:

- total impressions
- listing views
- click-through rate
- transactions
- sales conversion rate

This feedback applies only to IMNOVA's seller account and must never be presented as competitor history.

Client ID and client secret are not sufficient because Traffic Report requires seller authorization. Runtime also needs a seller refresh token with `sell.analytics.readonly`, stored only in the hosting secret manager:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_SELLER_REFRESH_TOKEN`

The access token is held in memory for the request, cleared after use, never returned and never logged.

The authenticated Admin dashboard is available at:

`/admin/ebay/seller-performance`

It supports official Traffic Report analysis by day or by up to 200 seller
listing IDs, with a maximum 90-day window. It maps eBay's positional
`metricValues` against the returned `header.metrics`, preserves unknown fields
for forward compatibility, and displays:

- total impressions
- total listing views
- click-through rate calculated from search-result views and impressions
- completed transactions
- sales conversion calculated from transactions and total views
- trend chart and row-level report details

The dashboard requires an authenticated IMNOVA Admin session. The refresh token
remains server-only, and the panel never exposes OAuth credentials to the
browser. The report applies only to IMNOVA's seller account and is not evidence
of competitor sales.

## Mobile review

The existing eBay demand action now also returns and displays:

- professional opportunity score
- demand, economics, identity, competition, supply and listing-readiness subscores
- decision
- rotation evidence status
- observed estimated weekly velocity only after a baseline exists
- median total buyer price
- estimated net profit
- official category and required aspects
- hard gates and evidence guards

On the first scan, the correct result is normally `WATCHLIST_BASELINE_REQUIRED`; the UI explicitly says that a second observation is needed.

## Safety

- No `main` touch.
- Supabase schema migrations applied; runtime observation writes remain disabled
  by default and require both server configuration and an explicit request.
- No eBay write endpoint.
- No draft, offer or listing.
- No publish operation.
- No token returned or logged.
- No competitor image downloaded or copied.
- No scraper.
- Human approval remains required.
- `canPublish` remains false.
