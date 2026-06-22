# PHASE 5B-A Price Intelligence API-Ready Audit

Date: 2026-06-22

## Scope

This document audits and designs a neutral Price Intelligence layer for the
eBay Winner Pipeline. It is documentation only. It does not connect to the
real eBay API, does not scrape, does not automate Aiprice, does not change
pipeline logic, does not add migrations, and does not relax profit thresholds.

The current Market Radar -> eBay Pipeline dryRun flow works, but real products
can be blocked because the pipeline does not yet have reliable market pricing
evidence. The core engine is behaving as designed: products with insufficient
estimated profit, margin, or ROI are blocked.

## Current Findings

The current pipeline maps a Market Radar product into an eBay candidate through
`buildEbayPipelineRadarProduct()` in `components/admin/market-radar-panel.tsx`.
The important pricing fields currently are:

- `price`: sent from Market Radar as the Luna/source cost.
- `compare_at_price`: sent through but not used by the core profit calculation.
- `estimated_sale_price`: not sent by the current Market Radar flow.
- `inventory_quantity`: sent as stock.
- `images_authorized`: intentionally sent as `false` by default.

The core profit calculation in `lib/ebay-winner-pipeline/core.mjs` uses:

- `estimated_sale_price`, when provided.
- Otherwise a fallback target price based on cost markup and a minimum buffer.
- Default fulfillment, packaging, shipping, eBay fee, advertising, and return
  reserve assumptions.

A candidate becomes `BLOCKED` when compliance is blocked or when profit
minimums fail. The main price-related blocker is:

- `margin_below_minimum`

The current minimums are:

- minimum profit: USD 5
- minimum ROI: 30%
- minimum net margin: 20%

This means Price Intelligence should improve the quality of
`estimated_sale_price`; it should not force approval.

## Why Price Intelligence Is Needed

The pipeline needs market evidence before deciding whether a Luna Portex product
can work on eBay. Without sold comparables or active comparable context, the
pipeline has to estimate a sale price from cost. That is safe but often too
coarse.

Price Intelligence should answer:

- What are equivalent items actually selling for on eBay?
- How many sold comparables support that price?
- Are active listings materially different from sold prices?
- What shipping cost should be assumed?
- How confident is the evidence?
- Is the recommended sale price enough to pass profit rules?

## Aiprice Positioning

Aiprice should be treated as a temporary external evidence source, not as the
architecture. The architecture should remain neutral so that manual input,
Aiprice data, Terapeak, ZIK, and a future eBay API adapter can all write the
same kind of snapshot.

The system should not contain an "Aiprice module" as the central domain concept.
The central concept should be Price Intelligence.

## Recommended Architecture

Recommended flow:

```text
Market Radar
  -> Price Intelligence Layer
  -> eBay Pipeline Evaluation
  -> eBay Pipeline Dashboard
  -> future Listing Quality Score
  -> future eBay API Draft/Listing with human approval
```

Responsibilities:

- Market Radar identifies source products and operational signals.
- Price Intelligence stores comparable market evidence and recommended price.
- eBay Pipeline evaluates profit, compliance, score, and state.
- Admin Dashboard exposes evidence and evaluation results read-only or with
  controlled admin actions.
- Future listing/draft actions remain separate and require human approval.

## Source Model

Recommended `source_type` values:

- `manual`
- `aiprice`
- `terapeak`
- `zik`
- `ebay_api`
- `other`

Recommended `marketplace` values for v1:

- `ebay`

Recommended `source_confidence` values:

- `low`
- `medium`
- `high`

Recommended `product_match_type` values:

- `exact`
- `same_model`
- `similar`
- `category_only`
- `unknown`

`confidence_score` should be numeric and bounded from 0 to 100.
`source_confidence` should be human-readable and derived from or aligned with
that score.

## Future Table Proposal

Future table name:

```sql
public.ebay_price_intelligence_snapshots
```

Proposed columns:

```sql
id uuid primary key default gen_random_uuid(),
candidate_id uuid null references public.ebay_product_candidates(id) on delete set null,
market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
supplier_sku text null,
candidate_key text null,

source_type text not null,
marketplace text not null default 'ebay',
search_query text null,
product_match_type text null,

sold_avg_price numeric(12,2) null,
sold_median_price numeric(12,2) null,
sold_min_price numeric(12,2) null,
sold_max_price numeric(12,2) null,
sold_comp_count integer not null default 0,

active_avg_price numeric(12,2) null,
active_min_price numeric(12,2) null,
active_max_price numeric(12,2) null,
active_comp_count integer not null default 0,

estimated_shipping_cost numeric(12,2) null,
recommended_sale_price numeric(12,2) null,
confidence_score numeric(5,2) not null default 0,
source_confidence text not null default 'low',

category_id text null,
category_name text null,
evidence_url text null,
evidence_notes text null,
raw_payload jsonb not null default '{}'::jsonb,

created_by text null,
created_at timestamptz not null default now()
```

Recommended constraints for a future migration:

- `source_type in ('manual', 'aiprice', 'terapeak', 'zik', 'ebay_api', 'other')`
- `marketplace in ('ebay')`
- `source_confidence in ('low', 'medium', 'high')`
- `product_match_type in ('exact', 'same_model', 'similar', 'category_only', 'unknown')`
- `confidence_score between 0 and 100`
- sold and active comp counts cannot be negative
- prices cannot be negative

Recommended indexes:

- `(candidate_id, created_at desc)`
- `(market_radar_product_id, created_at desc)`
- `(supplier_sku, created_at desc)`
- `(candidate_key, created_at desc)`
- `(source_type, created_at desc)`

RLS should follow the existing Admin-only model. Service role remains server-side
only. Client components must never receive service role keys.

## Decision Rules

Price Intelligence should be conservative:

- If reliable Price Intelligence exists, use `recommended_sale_price` as the
  candidate `estimated_sale_price`.
- If reliable shipping evidence exists, use it as `estimated_shipping_cost`.
- If data is insufficient, mark or keep the candidate as needing price data.
- Do not assume optimistic sale price.
- Do not use the highest comparable as the main reference.
- Prefer median sold price, or an adjusted average when justified.
- Active listings should be supporting context, not proof of demand.
- Sold comps should have priority over active comps.
- Exclude non-equivalent comparables.
- Consider pack size, brand, model, condition, quantity, size, and shipping.
- Keep `BLOCKED` if margin, profit, or ROI remain below minimums.
- Keep images unauthorized unless there is explicit evidence.
- Price Intelligence must not become automatic approval.

Recommended price derivation:

1. Start with sold median price when sold comp count is strong.
2. Compare sold average and median for outliers.
3. Use active average only as a sanity check.
4. Subtract or adjust for shipping when the comparable includes/free-ships.
5. Lower confidence when match type is not exact or comp count is low.
6. Store evidence notes explaining the recommendation.

Suggested data status:

- `price_data_ready`: enough sold or active evidence to evaluate.
- `needs_price_data`: no reliable pricing evidence.
- `price_data_low_confidence`: some evidence exists but should not drive
  automatic evaluation.

The current schema does not include a `NEEDS_PRICE_DATA` candidate state. For
Fase 5B-B, the safer first step is to store price data status in the snapshot
and optionally expose it in Admin UI. A future migration can decide whether a
new candidate state is warranted.

## Admin UI Design

### Market Radar

Recommended future controls:

- Button: `Agregar precio de mercado`
- Manual Price Intelligence form
- Source selector: `manual`, `aiprice`, `terapeak`, `zik`, `ebay_api`, `other`
- Marketplace fixed to `ebay` for v1
- Fields for:
  - search query
  - product match type
  - sold average, median, min, max
  - sold comp count
  - active average, min, max
  - active comp count
  - estimated shipping
  - recommended sale price
  - confidence score
  - source confidence
  - category id/name
  - evidence URL
  - evidence notes
- Future button: `Evaluar con Price Intelligence`

The existing `Evaluar en eBay Pipeline (dryRun)` button should remain dryRun and
should not create drafts, publish, call WhatsApp, or call `record_decision`.

### eBay Pipeline

Recommended future read-only display:

- Latest Price Intelligence snapshot.
- Source type and source confidence.
- Recommended sale price vs Luna cost.
- Sold comp count and sold median/average.
- Active comp count and active average.
- Estimated shipping.
- Category evidence.
- Evidence notes/link.
- Whether candidate still fails profit minimums.
- Existing blocker reason if still `BLOCKED`.

The panel should make clear that price evidence is not approval.

## API-Ready Service Design

Recommended future modules:

```text
lib/price-intelligence/types.mjs
lib/price-intelligence/service.mjs
lib/price-intelligence/adapters/base.mjs
lib/price-intelligence/adapters/manual.mjs
lib/price-intelligence/adapters/ebay-api.mjs
```

Recommended adapter shape:

```js
export class PriceIntelligenceSourceAdapter {
  sourceType = "manual"

  async fetchSoldComps(input) {
    throw new Error("not_implemented")
  }

  async fetchActiveComps(input) {
    throw new Error("not_implemented")
  }

  normalizeComps(rawPayload) {
    throw new Error("not_implemented")
  }

  calculateRecommendedSalePrice(normalizedComps) {
    throw new Error("not_implemented")
  }
}
```

Future eBay API functions:

```text
fetchSoldCompsFromEbayApi()
fetchActiveCompsFromEbayApi()
normalizeEbayApiComps()
calculateRecommendedSalePrice()
```

These should not be implemented in this audit phase.

## Future API Design

Recommended future endpoints:

```text
GET  /api/admin/price-intelligence?supplierSku=...&candidateId=...
POST /api/admin/price-intelligence
POST /api/admin/ebay-winner-pipeline/evaluate-with-price-intelligence
```

Rules:

- All endpoints protected by existing Admin validation.
- Write endpoints only accept Admin-authenticated requests.
- Service role only server-side.
- No eBay API credentials in client code.
- No scraping.
- No automatic WhatsApp.
- No draft creation.
- No publishing.
- Re-evaluation remains dryRun until an explicit future phase changes it.

## Integration With Current Pipeline

Recommended Fase 5B-B path:

1. Store a Price Intelligence snapshot for a Market Radar product or candidate.
2. Re-evaluate the product by injecting:
   - `estimated_sale_price: snapshot.recommended_sale_price`
   - `shipping_cost: snapshot.estimated_shipping_cost`, if present
   - `suggested_category_id`, if present
3. Keep the existing core minimums.
4. Persist a normal eBay Pipeline candidate/profit/compliance/score result.
5. Link the result back to the Price Intelligence snapshot through audit log or
   future relationship fields.

No existing draft or WhatsApp path should be reused for this.

## Risks

- Manual data can be wrong or biased.
- Aiprice output can be copied incorrectly.
- Active listings can be mistaken for real demand.
- Comparables may not be equivalent.
- Pack size, condition, model, and quantity mismatches can distort price.
- Shipping can be underestimated.
- High-price outliers can inflate recommended sale price.
- Users may manipulate price evidence to force validation.
- Risky brands or restricted products may still fail even with good pricing.
- Evidence URLs can expire.
- Evidence may lack date, source, or query details.
- Future eBay API access can change.
- Too much dependence on one external provider can recreate vendor lock-in.

## Recommended Plan For Fase 5B-B

Fase 5B-B should implement controlled manual Price Intelligence while still
avoiding eBay real, WhatsApp real, drafts, and publishing.

Recommended implementation steps:

1. Create migration for `ebay_price_intelligence_snapshots`.
2. Add Admin-only RLS/policies consistent with current `ebay_*` tables.
3. Create server-side service for controlled read/write.
4. Create protected Admin API endpoints.
5. Add Market Radar manual form for Price Intelligence snapshots.
6. Store manual/Aiprice evidence as snapshots.
7. Display latest price evidence in the eBay Pipeline detail panel.
8. Add a dryRun-only re-evaluation action using `recommended_sale_price`.
9. Preserve current profit thresholds and blocker behavior.
10. Add audit log entries for price intelligence creation and re-evaluation.

## Explicit Non-Goals

- No eBay API connection in this phase.
- No scraping.
- No Aiprice automation.
- No draft creation.
- No WhatsApp send.
- No publishing.
- No Store/Home changes.
- No Vercel variable changes.
- No Supabase migration in this audit phase.
- No pipeline threshold relaxation.
- No commit in this phase without human approval.

## Conclusion

Price Intelligence should be a neutral evidence layer between Market Radar and
the eBay Winner Pipeline. Aiprice can be one temporary source, but the domain
model must remain source-agnostic and API-ready. The immediate value is better
`estimated_sale_price` and shipping evidence so the current pipeline can make a
more accurate dryRun decision without weakening safety rules.
