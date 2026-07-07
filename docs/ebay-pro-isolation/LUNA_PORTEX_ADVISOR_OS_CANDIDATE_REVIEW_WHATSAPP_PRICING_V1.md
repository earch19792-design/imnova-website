# Luna Portex Advisor OS Candidate Review WhatsApp Pricing V1

## Why

LOOP 145 turns Winner Score V2 outputs into an executive review queue. It prepares what the human operator should see next: recommendation, pricing guidance, sourcing recommendation, blockers, warnings, and mobile approval intents.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 144 created Winner Score V2 and Buy-Direct Opportunity Score.
- WhatsApp real send remains blocked.
- eBay API, OAuth, drafts, listings, and publication remain blocked.

## What Advisor OS Candidate Review Does

- Builds an Advisor OS review per candidate.
- Generates clear recommendations for approval, images, sourcing quotes, watchlist, rejection, more data, or compliance review.
- Builds Pricing Advisor guidance from price confidence, price war risk, margin protection, perceived value, and pricing psychology.
- Builds direct sourcing recommendations.
- Builds WhatsApp-style mobile approval previews and action intents without sending anything.

## What It Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect eBay API, OAuth, Supabase, WhatsApp real send, OpenAI, scrapers, uploads, or VM resources.
- It does not create eBay drafts, listings, publications, migrations, SQL, tokens, or env files.

## WhatsApp Mobile Approval As Preview/Intents Only

LOOP 145 creates message previews and allowed action intents only. It never sends a real WhatsApp message. Prohibited actions such as `PUBLISH_LISTING`, `CREATE_EBAY_DRAFT`, `SEND_REAL_WHATSAPP`, `UPDATE_STAGING_DECISION`, and `TOUCH_PRODUCTION` are blocked from the model.

## Pricing Advisor Rules

- Do not lower price by default.
- Do not aim to be the cheapest.
- If images are missing, improve image/title before changing price.
- If sold data confidence is low, collect more data before changing price.
- If margin is destroyed, reject or watchlist instead of starting a price war.
- If price is competitive and margin is healthy, hold price or adjust gradually.

## Sourcing Recommendation Rules

The sourcing recommendation converts buy-direct score, profit upside, capital needed, risk level, and missing data into one of:

- keep selling via Luna Portex
- request direct supplier quote
- watchlist for volume
- buy direct small batch later
- reject direct buy

## Human Approval Boundaries

Every candidate requires human approval. Advisor OS can recommend a next step, but it cannot save a real decision, create a listing, create a draft, publish, or send a real WhatsApp message in this loop.

## Why No Draft/Listing/Publication Happens In LOOP 145

LOOP 145 is the review and approval preparation layer only. Listing package construction starts in LOOP 146. eBay Sandbox OAuth does not start until LOOP 148, and publication remains later in the route.

## How This Feeds LOOP 146 Listing Package Builder

LOOP 146 will consume Advisor OS recommendation, pricing guidance, sourcing recommendation, blockers, warnings, and mobile approval intents to build listing packages only after the human review path is ready.

## Safety Boundaries

- No Production write.
- No Staging write.
- No eBay API, OAuth, tokens, Supabase write, WhatsApp real send, OpenAI, drafts, publication, scrapers, downloads, migrations, SQL, or env changes.
- Outputs are local previews and intents only.

## Definition Of Done Applied

This loop is limited to Advisor OS candidate review, includes tests, includes dry-run output, runs previous regressions, reports numeric outputs, and keeps real actions blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what it protects, what was not touched, how it moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

146 — Listing Package Builder + WhatsApp Listing Approval
