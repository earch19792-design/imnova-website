# Luna Portex Listing Package Builder Value Pricing V1

## Why

LOOP 146 turns Advisor OS recommendations into professional eBay listing packages. The goal is to prepare title, description, item specifics, pricing guidance, trust signals, blockers, and mobile approval previews before any eBay draft exists.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 145 created Advisor OS candidate reviews and WhatsApp-style approval previews.
- eBay API, OAuth, drafts, listings, publication, Supabase writes, and real WhatsApp sends remain blocked.

## What Listing Package Builder Does

- Builds a listing package for each Advisor OS candidate review.
- Generates an eBay-safe title, bullet points, original description, suggested item specifics, category recommendation, condition, pricing recommendation, shipping and return policy recommendation, trust checklist, image requirements, compliance warnings, and readiness gates.
- Generates WhatsApp listing approval previews and action intents only.
- Explains why a package is blocked from draft or publication.

## What It Does Not Do

- It does not touch Production.
- It does not write to Staging.
- It does not connect Supabase, eBay API, OAuth, WhatsApp real send, OpenAI, scrapers, uploads, VM resources, SQL, or migrations.
- It does not create an eBay draft, listing, publication, token, or env file.

## Title Rules

- Maximum 80 characters.
- No keyword stuffing.
- No emojis.
- No all-caps title.
- No unconfirmed claims such as best, guaranteed, or official.
- Include useful product identity such as model, type, size, or condition when available.
- Rewrite supplier-style titles into clean marketplace language.

## Description Rules

- Original text only.
- No copied supplier description.
- Honest and professional tone.
- Explain what the product is, expected use, compatibility review needs, included information, and warnings.
- No medical claims, false guarantees, benchmark internals, or exaggerated claims.

## Value-Based Pricing Strategy

The pricing recommendation uses Advisor OS pricing inputs. It protects margin and perceived value instead of racing to the lowest visible active price.

- `doNotRaceToBottom` remains true.
- `lowestPriceNotRequired` remains true.
- If images are missing, improve images or title before changing price.
- If sold data confidence is low, request more pricing data.
- If margin is destroyed, reject or watchlist instead of creating a price war.
- The recommendation uses a price range when data supports it, not a rigid one-price answer.

## Trust-Based Listing Optimization

The package requires clear images, honest title and description, item specifics, shipping clarity, return policy clarity, and compliance review for risk categories such as aerosol, hazmat, electrical, battery, or spray products.

## WhatsApp Listing Approval Previews Only

LOOP 146 creates preview messages and action intents only. It does not send WhatsApp messages. Allowed intents include image workflow approval, title changes, price review, compliance review, image package request, watchlist, rejection, and full package view.

Prohibited actions remain blocked:

- `CREATE_EBAY_DRAFT`
- `PUBLISH_LISTING`
- `SEND_REAL_WHATSAPP`
- `UPDATE_STAGING_DECISION`
- `TOUCH_PRODUCTION`

## Why No eBay Draft/Listing/Publication Happens In LOOP 146

This loop prepares the package only. Image workflow starts in LOOP 147, eBay Sandbox OAuth starts in LOOP 148, and draft creation happens later. No package is allowed to create a real draft or publication in LOOP 146.

## How This Feeds LOOP 147 Image Package Workflow

LOOP 147 will use package blockers, image requirements, trust signals, compliance warnings, and WhatsApp listing approval previews to prepare the image package workflow and perceived value checks.

## Safety Boundaries

- No Production write.
- No Staging write.
- No Supabase write or SQL.
- No eBay API, OAuth, tokens, drafts, listings, publication, WhatsApp real send, OpenAI, uploads, scrapers, downloads, migrations, db push, db pull, or env changes.
- Outputs are local dry-run packages and preview intents only.

## Definition Of Done Applied

This loop is limited to Listing Package Builder, includes tests, includes dry-run output, runs previous regressions, reports numeric outputs, and keeps all real marketplace actions blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what problem it solves, what was protected, what changed materially, what was not touched, how this moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

147 — Image Package Workflow + WhatsApp Image Alerts
