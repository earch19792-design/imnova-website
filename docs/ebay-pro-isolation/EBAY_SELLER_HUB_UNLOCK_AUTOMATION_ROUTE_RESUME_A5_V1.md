# EBAY-RESUME-A5 - Seller Hub Unlock Model + Automation Route Reconciliation

## Why

EBAY-RESUME-A4 correctly captured missing Seller Hub data after the real read-only OAuth audit, but the business interpretation needed refinement. A new eBay seller account may expose payout, payment, and business policy setup through the natural first listing or first sale onboarding flow. That means missing policy data is not automatically a permanent blocker to automation design.

This loop reconciles the route so IMNOVA OS can keep moving toward controlled automation while still protecting the seller account.

## Current state

- EBAY-RESUME-A is integrated.
- EBAY-RESUME-A2 is integrated.
- EBAY-RESUME-A3 is integrated.
- EBAY-RESUME-A4 is integrated.
- Amazon 149G remains paused and is not part of this eBay route.
- Old local eBay LOOP 149 remains separate and is not mixed into this route.
- Production and main remain off limits.

## A3-RUN sanitized result

The real Production read-only OAuth audit succeeded. It confirmed OAuth read-only access can work without eBay write API usage, draft creation, listing creation, publication, token storage, or token printing.

The audit also showed:

- business policies were not readable through the tested path.
- fulfillment policy count was 0.
- return policy count was 0.
- payment policy count was 0.
- inventory location count was 0.
- eBay write API was not used.
- no token was stored or printed.

## A4 result

A4 converted that result into a Seller Hub missing data fix plan. It identified missing fulfillment, return, payment, and inventory location readiness, plus manual Seller Hub checks for account alerts, identity verification, payments and payouts, seller limits, messages, business conversion, and final checklist confirmation.

The new interpretation is that these gaps should block real publication, but they should not block preparing an automated listing package.

## New discovery

For a new seller account, payout, payment, and policy setup can be part of eBay's onboarding flow during the first listing or first sale. Therefore A5 treats these as unlock-model items:

- payout/payment setup may unlock after listing flow or first sale.
- business policies may unlock during listing flow.
- missing policy reads may also be scope/API availability gaps.
- none of these should be treated as proof that the account is permanently blocked.

## User-configured Seller Hub state

The user confirmed:

- Seller Hub is active.
- no critical alerts are visible.
- messages seen so far are not critical blockers.
- store name is configured as `ShopEliteCart`.
- ship-from location is configured manually with Luna Portex.
- return address is configured manually with Luna Portex.
- purchase address is configured in the USA.

The warehouse is modeled only as:

- warehouse alias: `LUNA_PORTEX_BOCA_RATON`
- city: Boca Raton
- state: FL
- postal code: 33487
- country: US

The full Luna Portex street address is not stored in Git.

## Manual does not mean manual listing strategy

A5 separates manual safety gates from automated listing preparation.

Manual remains required for:

- identity and account-risk checks.
- payout, bank, tax, and payment setup.
- sensitive Seller Hub settings.
- final human approval before any draft, listing, or publication.

Automation should handle:

- benchmark research.
- competitor sold-listing analysis.
- winner scoring.
- title and item specifics preparation.
- price and margin guardrails.
- policy recommendations.
- image checklist.
- eBay API payload preparation.
- future gated draft or unpublished offer building.

## Corrected automation route

The corrected route is:

1. EBAY-RESUME-A5 - reconcile unlock model and automation boundary.
2. EBAY-RESUME-C-AUTO - build first automated listing package from benchmark.
3. EBAY-RESUME-B2 / LOOP 149R - build gated draft or unpublished offer payload.
4. LOOP 150 - controlled publication only after approval and account readiness.

## Why not publish yet

A5 does not create drafts, listings, or publications. Publication remains blocked until:

- a low-risk product candidate is selected.
- Seller Hub account risk remains clear.
- payment, payout, and policy state is understood.
- the listing package is reviewed by a human.
- a future gated write loop is explicitly approved.

## Safety boundaries

This loop is local and read-only. It does not call eBay API, does not run OAuth, does not exchange or store tokens, does not write to Production, does not touch main, does not write to Staging DB, does not create drafts, does not create listings, and does not publish.

It also does not mix Amazon 149G or the old local eBay LOOP 149.

## Definition of Done

- A local fixture models the unlock interpretation.
- A pure module builds the route reconciliation report.
- A dry-run prints the route summary.
- Tests validate the unlock model, automation boundary, safety flags, and warehouse alias rule.
- No full warehouse street address is committed.
- No API, OAuth, token, draft, listing, or publication action is executed.

## Human explanation rule

This route must be explainable to a non-technical seller: IMNOVA OS is not publishing yet. It is preparing the listing work professionally, while the human keeps control over account setup and final approval.

## Next step

The next recommended route is `EBAY-RESUME-C-AUTO - First Automated Listing Package from Benchmark`, unless an account risk appears or a product candidate is missing.
