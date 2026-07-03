# IMNOVA eBay Domain Boundaries V1

## Why this separation exists

Supabase reported a Disk IO warning for `imnova-staging`. The current Admin experience has several large pages and panels that mix Market Radar, eBay Seller OS, Pipeline, Listing, image QA, fixtures and technical gates. When one screen loads too much at once, it increases read pressure, makes the seller workflow harder to understand and raises the risk of accidental coupling.

This separation exists so each module can read only what it needs, keep its responsibility clear and avoid loading Radar, Pipeline and Listing together unless the seller explicitly chooses that workflow.

## Market Radar

Market Radar is responsible for:

- Discovering market and supplier signals.
- Stock visibility.
- Out of stock detection.
- Discounts.
- Price and stock alerts.
- Candidate discovery.

Market Radar must not:

- Prepare listings.
- Decide title or description.
- Publish.
- Create drafts.
- Recalculate listing readiness.

## eBay Seller OS

eBay Seller OS is responsible for:

- The seller operating flow.
- Operational queues.
- Vender ahora.
- Revisar stock.
- Margen.
- Bloqueados.
- Rescates / packs.
- Proteger.
- Operational decisions.

eBay Seller OS must not:

- Generate full listing content.
- Recalculate product facts.
- Publish.
- Create drafts.

## eBay Listing

eBay Listing is responsible for:

- Preparing the listing.
- Title.
- Description.
- Item specifics.
- Main image and six planned secondary images.
- Image prompts.
- Payload dry run.
- Review/Gates.

eBay Listing must not:

- Decide whether the product is profitable.
- Duplicate profitability truth.
- Recalculate margin, demand or competition.
- Publish.
- Create a real draft.

## Shared

Shared areas include:

- Products.
- Product source adapter.
- Winner-to-listing bridge.
- Safety and gates helpers.
- Shared tests while the migration is still in progress.

## Data Boundaries

- Market Radar can read signal data, stock data, out of stock snapshots, discounts and alerts, but it should use limits, pagination and summaries.
- eBay Seller OS should read queue summaries and the operational candidates needed for the selected queue, not full Radar history.
- eBay Listing should read the selected product, Products facts and minimal Pipeline context by reference, not the full Radar or Pipeline dataset.
- A future advisor should read summaries and prepared context, not complete raw tables.

## Migration Plan

A. Documentation + lightweight hubs.

B. Navigation separation.

C. Extract UI subcomponents.

D. Move pure modules by domain.

E. Split tests by domain.

F. Disk IO optimization with summary endpoints/views.

## Current Large Files

- `app/admin/page.tsx`
- `components/admin/market-radar-panel.tsx`
- `components/admin/ebay-winner-pipeline-panel.tsx`
- `app/admin/ebay-listing-package/page.tsx`
- `tools/ebay-winner-pipeline-tests.mjs`

## Safety Rules

- No eBay API.
- No real draft.
- No publication.
- No Supabase write in separation loops.
- No hidden data loading in hubs.

## Future Pending Strategic Modules

- eBay Benchmark Intelligence.
- eBay Seller OS Module Hub.
- IMNOVA Advisor for eBay Seller OS.
- Real Image Execution from Luna Portex Catalog.
- eBay Sandbox Integration.
