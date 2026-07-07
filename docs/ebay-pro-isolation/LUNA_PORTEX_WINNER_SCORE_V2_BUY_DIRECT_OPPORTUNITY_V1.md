# Luna Portex Winner Score V2 Buy Direct Opportunity V1

## Why

LOOP 144 converts benchmark outputs into a commercial decision layer. The goal is to decide which Luna Portex candidates should go to Advisor OS, which should wait, which need images, stock, compliance review, or sourcing work, and which should be rejected for now.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 143 created benchmark data for sold price intelligence, pricing psychology, direct sourcing, and price war protection.
- LOOP 144 is local/dry-run only and does not write to Staging.

## What Winner Score V2 Does

- Calculates Winner Score V2 from benchmark outputs.
- Calculates demand, profitability, price confidence, margin protection, perceived value, data quality, stock readiness, competition risk, compliance readiness, image readiness, and final risk penalty.
- Calculates Buy-Direct Opportunity Score.
- Produces seller decision: `SELL`, `REVIEW`, `WATCHLIST`, or `REJECT`.
- Produces readiness gates for Advisor OS and future listing workflows.

## What Winner Score V2 Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect eBay API, OAuth, Supabase, WhatsApp, OpenAI, scrapers, uploads, or VM resources.
- It does not create drafts, listings, publications, migrations, SQL, or env files.

## Score Components

Winner Score V2 includes:

- demand score
- profitability score
- price confidence score
- margin protection score
- perceived value score
- data quality score
- stock readiness score
- competition risk adjusted score
- compliance readiness score
- image readiness score
- final risk penalty

## Buy-Direct Opportunity Score

The Buy-Direct Opportunity Score estimates whether a candidate should stay in the Luna Portex resale path, wait, request a supplier quote, or become a small-batch direct buy candidate. It includes direct buy cost, profit upside per unit, capital needed, capital risk, direct sourcing decision, and missing data before direct buy.

## Pricing Psychology Rules

The model keeps `doNotRaceToBottom` and `lowestPriceNotRequired` true. It does not recommend selling only because a product could be priced low. Price confidence, margin protection, perceived value, and benchmark confidence must support the decision.

## Price War Protection

High competition pressure becomes a risk adjustment and warning. It does not automatically lower price. If margin protection is weak or data quality is low, the model blocks SELL and moves the candidate to review, watchlist, or rejection.

## Readiness Gates

LOOP 144 creates gates for:

- benchmark readiness
- Advisor OS review
- Listing Builder
- Image Workflow
- eBay Sandbox Draft
- Real Listing

## Why No Product Can Be Real-Listing-Ready In LOOP 144

LOOP 144 is a scoring and decision loop only. Real listing readiness requires later human approval, image workflow, listing package builder, sandbox draft, and final approval loops. Therefore `readyForRealListing` is always false in LOOP 144.

## How This Feeds LOOP 145 Advisor OS

LOOP 145 will consume Winner Score V2 results, seller decision, sourcing recommendation, pricing advisor inputs, readiness gates, reasons, blockers, and warnings for human review and mobile approval.

## Safety Boundaries

- No Production write.
- No Staging write.
- No eBay API, OAuth, tokens, WhatsApp real send, OpenAI, drafts, publication, scrapers, downloads, migrations, SQL, or env changes.
- Fixtures and calculations are local and sanitized.

## Definition Of Done Applied

This loop is limited to Winner Score V2 and Buy-Direct Opportunity Score, includes tests, includes a dry-run, runs previous regressions, reports numeric outputs, and keeps all external actions blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what it protects, what was not touched, how it moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

145 — Advisor OS Candidate Review + WhatsApp Mobile Approval + Sourcing Recommendation + Pricing Advisor
