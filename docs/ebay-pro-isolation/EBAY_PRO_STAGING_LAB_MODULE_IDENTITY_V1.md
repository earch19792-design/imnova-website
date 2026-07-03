# eBay Pro Staging/Lab Module Identity V1

## Why

IMNOVA Production must remain clean for IMNOVA Core. eBay Professional Seller Suite needs a clear module identity so staging and lab can operate it without implying that production should execute heavy eBay workflows.

## What Is eBay Professional Seller Suite

eBay Professional Seller Suite is the operational module for:

- Market Radar eBay.
- eBay Seller OS.
- eBay Listing.
- eBay Listing Package.
- Future image workflow.
- Future benchmark intelligence.
- Future sandbox integration.

## Production Boundary

Production is IMNOVA Core only. Production must not execute eBay Pro routes, heavy reads, candidates, snapshots, listing package dry-runs or future benchmark/image/sandbox workflows.

## Staging Responsibility

Staging is the official controlled testing environment for eBay Pro. Staging can run the suite with limits, dry-run defaults, safety gates and summaries.

## Local VM Responsibility

The Local Network VM is the future heavy-processing lab. It is planned for large fixtures, workers, scans, benchmarks and test database workloads. It is not connected in this loop.

## Module Routes

- `/admin/ebay-pro`
- `/admin/market-radar`
- `/admin/ebay-seller-os`
- `/admin/ebay-listing`
- `/admin/ebay-listing-package`
- `/admin/ebay-listings`
- `/admin/ebay-image-generator`

## API Routes

- `/api/admin/market-radar`
- `/api/admin/ebay-winner-pipeline`
- `/api/admin/active-listing-risks`
- `/api/admin/ebay/oauth`

## Data Boundaries

IMNOVA Core keeps products, community, store, campaigns and general analytics.

eBay Pro owns radar, Seller OS, listing, candidates, snapshots and future benchmark/image/sandbox workflows.

Shared data must stay minimal: `product_id`, `slug`, product facts and status summary.

## What Is Independent Now

- eBay Pro has a named hub.
- eBay Pro has a manifest.
- eBay Pro has staging/lab-only policy.
- Production gate blocks eBay Pro routes.
- Tests define the module identity and production boundary.

## What Is Not Independent Yet

- Database is not physically separate yet.
- Repo is not separate.
- Local VM is not connected.
- Heavy workers are not moved yet.
- UI panels are not split into a separate app yet.

## Next Steps

1. Add staging-only flags for eBay Pro.
2. Move heavy tests and workers to the Local Network VM.
3. Keep staging on controlled summaries and samples.
4. Evaluate a physically separate database if volume grows.
