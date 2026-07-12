# EBAY Mobile Review — Mobile UX and Decision Architecture V2

## Why this loop exists

The first Mobile Review loops proved the read-only Market Radar connection, Radar guards, manual confirmation reconciliation, freshness tolerance, pinned continuity and supplier drift detection. The resulting page was safe but exposed too much implementation detail in one continuous mobile page. It also had multiple competing route outputs, seeded operational pinned state from a fixture, used prefilled manual values and reconciled pinned candidates only against the current Top 5.

V2 turns those capabilities into a safer mobile workflow without expanding write authority.

## Scope

- Route: `/admin/ebay/mobile-review`.
- Read source: `MARKET_RADAR_READONLY` through the existing internal GET.
- Demo source: `DEMO_FIXTURE_ONLY` only when explicitly requested with `?demo=1`.
- Persistence: versioned and validated browser `localStorage` for non-sensitive pinned continuity.
- Official approval record: false.
- `canPublish`: always false.

## Decision architecture

V2 separates the decision layers:

1. Market Radar observation.
2. Supplier drift evaluation.
3. Human confirmation reconciliation.
4. Radar guard evaluation.
5. Authoritative effective decision.

`buildMobileReviewEffectiveDecision` produces one `nextRecommendedRoute`. The UI does not treat the reducer route, Radar route or pinned route as independently authoritative.

## Pinned continuity corrections

- Real mode starts with an empty pinned collection. No fixture initializes operational browser state.
- Stored data has a schema version, save timestamp, runtime shape validation and expiration.
- Invalid, incompatible or expired state is ignored safely.
- Each pinned candidate exposes its own `canContinueEbayMarketValidation`.
- Recheck and supplier drift use all Radar candidates, not only the current Top 5.
- The model distinguishes `PRESENT_IN_RADAR_OUTSIDE_TOP5` from absence in Radar.
- Completing the four human confirmation steps creates or updates browser-only pinned continuity.

## Mobile information architecture

The page has four explicit sections:

- Top 5: condensed candidate cards.
- En revisión: pinned continuity and supplier drift.
- Bloqueados: paginated STOCK_HOLD candidates.
- Decisión: guided confirmation and the authoritative next route.

Technical IDs and full guard data use progressive disclosure. A selected candidate produces a persistent bottom action bar. The page no longer renders every blocked product at once.

## Confirmation safety

- Stock and Luna price begin empty.
- Stock accepts only positive integers.
- Luna price must be a positive number.
- Selecting another candidate clears manual values.
- The four steps are product identity, stock, Luna price and image.
- B2-RUN remains visibly disabled and explains the next required route.
- Supplier data remains subject to drift detection after human confirmation.

## Loading and source states

The UI distinguishes:

- `READY`
- `RADAR_EMPTY`
- `AUTH_REQUIRED`
- `RADAR_REQUEST_FAILED`
- `DEMO_FIXTURE_ONLY`

The source badge is derived from the actual data source and load state, so an empty or failed response is not labeled as real Radar data.

## Accessibility and mobile behavior

- Touch controls use at least 44–48 px height.
- Visible labels accompany manual inputs.
- Focus-visible styles are present on primary navigation and controls.
- Action feedback uses a non-sticky `role=status` live region.
- Automatic scrolling honors `prefers-reduced-motion`.
- Text contrast was increased for operational content.
- Score ties remove the definitive “Recommended” label and show provisional ordering.

## Safety boundaries

- No Production write.
- No main changes or merge to main.
- No Staging database write.
- No Supabase write.
- No eBay API or eBay write.
- No draft, offer, listing, publication or `publishOffer`.
- No real WhatsApp.
- No token, secret or `.env` additions.
- No scraper, Amazon track or image asset additions.

## Definition of Done

- One authoritative effective route.
- Empty manual defaults.
- No operational fixture seeding.
- Versioned local state validation and expiration.
- Independent pinned candidate decisions.
- Recheck against the complete Radar result.
- Modern section navigation and progressive disclosure.
- Blocked list pagination.
- Clear loading/error states and retry.
- B2-RUN and publication remain blocked.
- TypeScript, focused tests, regressions and disk guardrails pass.

## Human explanation rule

The interface presents a human label first and retains machine route/action codes only as secondary diagnostic context. A person using a phone should understand what to do next without interpreting internal enum names.
