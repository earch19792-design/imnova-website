# Luna Portex Image Package Workflow Perceived Value V1

## Why

LOOP 147 turns Listing Package Builder output into a professional image workflow for eBay. It defines what images are needed, why they matter, and what blocks a product from moving toward a draft later.

## Current State

- Production remains frozen and Core-only.
- eBay Pro remains isolated in PRE/Staging.
- LOOP 146 created listing packages, value-based pricing, trust signals, and WhatsApp listing approval previews.
- eBay API, OAuth, drafts, publication, image generation, uploads, OpenAI, and WhatsApp real send remain blocked.

## What Image Package Workflow Does

- Builds image requirements per listing package.
- Defines the main image checklist.
- Defines secondary image types.
- Scores perceived visual value and image readiness.
- Produces image readiness gates and blockers.
- Creates internal production guidance for future visual work.
- Creates WhatsApp image alert previews and action intents only.

## What It Does Not Do

- It does not generate images.
- It does not upload images.
- It does not call OpenAI.
- It does not touch Production.
- It does not write to Staging.
- It does not connect eBay API, OAuth, Supabase, WhatsApp real send, scrapers, downloads, uploads, SQL, migrations, VM resources, or env files.
- It does not create an eBay draft, listing, or publication.

## Main Image Rules

The main image must use a real product photo. It must use a white or clean neutral background, keep the product centered, avoid text overlay, avoid watermarks, avoid added external logos, avoid people unless justified outside the main image, avoid generated fake product imagery, target at least 1600px on the longest side, show a single product clearly, and never alter the product appearance.

## Secondary Image Plan

The workflow plans up to six secondary image types:

- product-in-use / real use context
- material or detail zoom
- package contents
- dimensions / size context
- benefit visual
- lifestyle or use scenario

Special categories receive review notes. Aerosol or spray paint needs compliance/shipping review language and no hazmat claim without confirmation. Electrical products need safety or certification detail only when confirmed. Cleaning or chemical products need safe-use context when applicable.

## Perceived Value Image Check

The perceived value check calculates:

- perceivedValueImageScore
- mainImageReadinessScore
- secondaryImageCompletenessScore
- trustImageScore
- conversionImageScore
- imageRiskPenalty
- missingImageTypes
- imageWarnings

The score is local guidance only. It does not publish, upload, or generate anything.

## Image Readiness Gates

The gates decide whether the package is ready for image production, listing package approval, eBay draft, real listing, and whether it is blocked by missing main image, missing secondary images, compliance image review, or low perceived value.

In LOOP 147, `readyForEbayDraft`, `readyForRealListing`, `canCreateEbayDraft`, and `canPublishRealListing` are always false.

## WhatsApp Image Alerts Previews Only

LOOP 147 creates WhatsApp-style previews and mobile action intents only. It never sends a real message. Allowed intents include approving the image workflow, requesting main image, requesting secondary images, requesting dimension image, requesting lifestyle image, requesting compliance image review, moving to watchlist, and viewing image requirements.

Prohibited actions remain blocked:

- `GENERATE_IMAGE_WITH_OPENAI`
- `UPLOAD_IMAGE`
- `CREATE_EBAY_DRAFT`
- `PUBLISH_LISTING`
- `SEND_REAL_WHATSAPP`
- `UPDATE_STAGING_DECISION`
- `TOUCH_PRODUCTION`

## Why No Image Generation/Upload Happens In LOOP 147

This loop defines the workflow and requirements only. It does not create image files, synthetic images, product renders, edits, or uploads. Future visual production must use real product photos and must not invent product features or claims.

## Why No eBay Draft/Listing/Publication Happens In LOOP 147

OAuth starts in LOOP 148. Draft and publication remain later in the route. This loop exists to make sure image quality and perceived value are ready before any marketplace draft is considered.

## How This Feeds LOOP 148 eBay Sandbox OAuth

LOOP 148 can start Sandbox OAuth with a clearer understanding of which candidates have image requirements and which are blocked before draft creation. The image workflow also protects future draft quality.

## Safety Boundaries

- No Production write.
- No Staging write.
- No Supabase write or SQL.
- No eBay API, OAuth, tokens, draft, listing, publication, WhatsApp real send, OpenAI, image generation, uploads, scrapers, downloads, migrations, db push, db pull, or env changes.
- Outputs are local dry-run requirements, scoring, gates, prompts, and preview intents only.

## Definition Of Done Applied

This loop is limited to Image Package Workflow, includes tests, includes dry-run output, runs previous regressions, reports numeric outputs, and keeps all real image, marketplace, and messaging actions blocked.

## Human Explanation Rule Applied

The final report must explain what changed, why it changed, what problem it solves, what was protected, what changed materially, what was not touched, how this moves IMNOVA toward eBay sales, and the exact next loop.

## Next Step

148 — eBay Sandbox OAuth
