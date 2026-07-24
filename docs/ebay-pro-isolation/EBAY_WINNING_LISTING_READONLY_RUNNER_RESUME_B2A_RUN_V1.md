# EBAY-RESUME-B2A-RUN — Controlled eBay Read-Only Winning Listing Resolver Execution

## Why

B2A proved the Luna-first and market-first models with local fixtures, but it correctly left real eBay winning data and the real Luna match unconfirmed. B2A-RUN adds a tightly gated path for official eBay read-only comparable searches before any draft execution.

## Current state

- B2A is integrated in PRE/Staging and routes to B2A-RUN.
- The source candidate is an unbranded silicone cable-organizer multipack, risk LOW.
- The B2A optimized title and USD 18.99 price are hypotheses, not verified marketplace facts.
- The full warehouse street address remains outside version control; only `LUNA_PORTEX_BOCA_RATON`, Boca Raton, FL 33487, US is modeled.

## Official route

1. B2A-RUN — controlled eBay read-only comparable resolver.
2. B2-RUN — controlled draft or unpublished-offer execution after market, Luna, risk, and approval gates pass.
3. LOOP 150 — first human-approved real listing.
4. LOOP 151 — Seller OS dashboard.
5. LOOP 152 — active listing monitor, Luna scan, stock guard, and alerts.

## Separation of responsibilities

The TypeScript module is pure: it normalizes sanitized market inputs, analyzes keywords, price, category, specifics, Luna match, and risk, and chooses a route. It has no environment, network, filesystem, database, or credential capability.

The dry-run uses only the local fixture. It proves the default route is `NEED_MARKET_DATA` and never contacts eBay.

The real runner is the only file allowed to read local environment variables or use network requests. It defaults to safe mode and requires the execution flag, exact approved environment values, and exact interactive confirmation before any OAuth or API request.

## Official API boundary

The market allowlist contains only official eBay Browse API keyword search using `GET /buy/browse/v1/item_summary/search` against `api.ebay.com`. The runner obtains an application token using the official client-credentials grant, keeps it only in memory, clears the local reference, and never prints credentials or token values.

The Browse API provides active item summaries and refinements useful for keyword, price, category, condition, buying-option, and seller-signal analysis. Production access to Buy APIs can depend on eBay eligibility. The runner reports access failures safely without exposing response bodies.

No Sell Inventory, Account, Offer, listing, draft, or publication endpoint is allowlisted. Any non-GET market endpoint is blocked before a request.

## Query plan

- `silicone cable organizer clips 20 pack`
- `20 pack cable organizer self adhesive`
- `adhesive cord holder desk organization`

Each query is URL-encoded by the platform URL builder. Results are deduplicated by item identifier and limited before pure analysis.

## Sold and completed data

Browse search returns purchasable/active comparable items; it does not establish completed-sale history for this runner. Unless an approved official read-only endpoint and scope provide sold/completed evidence, the report must keep `soldDataResolved: false` and use `unavailable_or_scope_missing`. It must never infer sold counts from active results.

## Copy safety

Comparable titles can be tokenized in memory to confirm a small safe vocabulary. Exact titles, descriptions, images, item URLs, and competitor brands are not retained in the enriched candidate. The runner does not generate images or claims.

## Bundle and pack strategy resolver

The resolver also detects whether active comparables present the product as a single unit, numbered pack, multipack, bulk pack, value pack, bundle, or set. It recognizes 1, 2, 3, 4, 6, 10, 12, and 20 pack signals, groups prices by pack size, estimates per-unit pricing, and identifies the dominant pack without copying a title.

A dominant pack does not automatically become the recommendation. The pack margin guard requires confirmed Luna quantity, supplier unit cost, estimated shipping cost, and at least a 15 percent modeled margin. Large packs with high observed shipping cost receive a shipping-risk flag. Missing Luna quantity produces `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`; weak margin or shipping produces `DO_NOT_BUNDLE`. Every pack recommendation requires human approval and keeps publication disabled.

When pack signals, quantity, margin, and shipping are safe, the enriched B2-RUN candidate includes the primary and secondary pack sizes, bundle strategy, original pack-title candidate, readiness, and approval requirement.

Low-cost small items receive an additional shipping-dilution evaluation. When
the verified supplier cost per base item is strictly below USD 6 and the exact
package is at most 216 cubic inches with no side above 12 inches, the system
proposes 2×, 3× and 4× presentations. It recommends a specific pack only when
its shipping remains nearly flat (no more than 35% plus USD 1 above the base
shipment), shipping per base item falls at least 25%, and the exact pack also
passes demand, stock, contents/GTIN, weight/dimensions, profit, ROI and margin
gates. Missing evidence produces a review proposal, never an inferred pack or
automatic publication.

## Route decisions

- `NEED_MARKET_DATA`: official comparable data is missing or insufficient.
- `NEED_LUNA_MATCH`: comparable signals exist but the real supplier match is unconfirmed.
- `NEED_HUMAN_APPROVAL`: market and Luna facts are ready but approval is missing.
- `EBAY-RESUME-HOLD`: account or product risk is high.
- `EBAY-RESUME-B2-RUN`: comparable signals, Luna match, low risk, category/specifics, price range, and explicit human approval are all confirmed.

## Why no draft is created

B2A-RUN is research-only. Even a successful read-only run cannot create inventory items, offers, drafts, listings, or publications. B2-RUN remains a separate future loop with its own stricter approval gate.

## Safety boundaries

- No Production marketplace write, main change, Staging database write, or Supabase operation.
- No eBay write API or write endpoint.
- No token storage or printing, credential printing, filesystem write, scraper, image generation, or external AI API.
- No competitor content copying, Amazon track mixing, old eBay draft-work mixing, secrets, environment files, dumps, images, or full warehouse street address.
- `canPublish` is always false.

## Definition of Done

- Fixture, pure module, dry-run, gated runner, tests, and documentation exist.
- Default runner performs no OAuth or API request.
- Execute mode requires exact environment approval and terminal confirmation.
- Only client-credentials token exchange and official Browse search GET are possible.
- Dry-run routes to `NEED_MARKET_DATA`.
- Sold data remains explicitly unavailable when not supplied by an approved endpoint.
- Real comparable, Luna, risk, and approval scenarios route deterministically.
- Full validation and static safety checks pass.

## Human explanation rule

Every report must distinguish active comparables from sold evidence, explain whether real data was obtained, state why Luna match is or is not confirmed, list unresolved gates, and confirm that no marketplace write occurred.

## Next step

Run the gated resolver only with explicit authorization and valid local credentials. If the read-only evidence is sufficient, the Luna match is independently confirmed, risk remains LOW, and Ernesto approves, the next route is **EBAY-RESUME-B2-RUN — Controlled Draft / Unpublished Offer Execution**. Otherwise remain in the appropriate data, match, approval, or hold route.
