# Luna Portex Benchmark Data Model Direct Sourcing Pricing V1

## Why

LOOP 143 prepares the local benchmark model that decides whether Luna Portex candidates deserve deeper eBay scoring. It connects sold price intelligence, competition, demand, pricing psychology, margin protection, price war protection, and direct sourcing signals without using live marketplace integrations.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 142 wrote the first real mini scan candidates to Staging.
- LOOP 143 does not write to Staging and does not call any live eBay, Terapeak, scraper, or external data source.

## What This Benchmark Model Does

- Loads sanitized Luna Portex candidate rows.
- Loads sanitized sold price intelligence samples.
- Calculates average sold price, median sold price, sold count, active competition count, sell-through estimate, sold price range, recommended benchmark range, and confidence.
- Calculates pricing psychology inputs for confidence, price war risk, perceived value, margin protection, and price guidance.
- Calculates direct sourcing signals, direct buy upside, capital risk, and suggested sourcing action.
- Produces readiness output for LOOP 144 Winner Score V2.

## What This Benchmark Model Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not call eBay API, OAuth, Terapeak, scrapers, WhatsApp, AI model services, or uploads.
- It does not create drafts, listings, migrations, SQL, tokens, or env files.

## Sold Price Intelligence

Sold price intelligence focuses on completed buyer behavior, not seller hopes. The model calculates average and median sold price from sanitized completed listing samples, then compares that against active competition and sample sell-through.

## Pricing Psychology Inputs

The model avoids assuming that the cheapest listing wins. It returns:

- recommended price position
- price confidence score
- price war risk score
- perceived value score
- margin protection score
- price change guidance
- `doNotRaceToBottom: true`
- `lowestPriceNotRequired: true`

## Direct Sourcing Signals

Direct sourcing signals estimate whether a candidate should stay as a Luna Portex resale candidate or become a future supplier/brand sourcing opportunity. The model calculates direct buy cost, profit upside, opportunity score, capital risk, required missing data, and suggested sourcing action.

## Price War Protection

Price war risk is treated as a warning, not a command to lower price. If pricing pressure exists, the model favors better images, stronger title, measured price changes, or rejection when margin is destroyed.

## Why Average Sold Price Matters More Than Active Price

Active prices show what sellers ask. Sold prices show what buyers actually paid. LOOP 143 uses sold prices as the benchmark anchor because they better represent demand, conversion, and real buyer willingness.

## Why Lowest Price Is Not The Goal

Lowest price can destroy margin, train buyers to wait, and make the listing look low trust. The model explicitly preserves margin and perceived value, and it rejects race-to-bottom behavior by default.

## How This Feeds LOOP 144 Winner Score V2

LOOP 144 will consume these benchmark outputs as inputs for Winner Score V2, including buy-direct opportunity, price confidence, price war risk, perceived value, and margin protection.

## Safety Boundaries

- No Production write.
- No Staging write.
- No eBay API, OAuth, tokens, Terapeak, scraping, WhatsApp real send, AI model calls, migrations, or env file changes.
- Fixtures are sanitized and local.

## Definition Of Done Applied

This loop is limited to the benchmark model objective, includes tests, includes a dry-run, runs previous regressions, reports numeric outputs, and keeps writes blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what it protects, what was not touched, how it moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

144 — Winner Score V2 + Buy-Direct Opportunity Score
