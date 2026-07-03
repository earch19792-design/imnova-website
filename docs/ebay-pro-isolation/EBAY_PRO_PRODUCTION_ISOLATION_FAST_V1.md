# eBay Pro Production Isolation Fast V1

## Why

Supabase reported Disk IO Budget pressure on `imnova-staging`. The fastest protection is to prevent the eBay Professional Seller Suite from running in IMNOVA Production while keeping it available in staging, preview, development and local lab contexts.

Production is IMNOVA Core only. eBay Pro belongs in staging/lab until the workload is proven safe.

## Architecture

```text
IMNOVA Production
  -> Core only

IMNOVA Staging
  -> eBay Professional Seller Suite

Local Network VM
  -> Heavy scans/workers/lab DB
```

## Production Responsibility

Production should serve:

- Real business.
- Store.
- Public products.
- Community.
- Campaigns.
- General analytics.
- Stable approved data.

Production should not run:

- Market Radar eBay.
- eBay Seller OS.
- eBay Listing.
- eBay Listing Package.
- eBay Winner Pipeline.
- Active listing risks.
- Future benchmark.
- Future image workflow.
- Future sandbox.

## Staging Responsibility

Staging can run controlled eBay Pro testing:

- Market Radar eBay.
- eBay Seller OS.
- eBay Listing.
- Candidates dry-run.
- Limited snapshots.
- Limited price intelligence.
- Listing packages dry-run.
- Seller OS and Radar tests.

## Local Network VM Responsibility

The local VM is documented as the place for heavy workloads:

- Separate test database.
- Workers.
- Simulated scans.
- Large datasets.
- Experimental benchmark.
- Load tests.
- Heavy fixtures.

The VM is not connected in this loop.

## Blocked Production Paths

The fast gate blocks these eBay Pro paths in production:

- `/admin/market-radar`
- `/admin/ebay-seller-os`
- `/admin/ebay-listing`
- `/admin/ebay-listing-package`
- `/admin/ebay-listings`
- `/admin/ebay-image-generator`
- `/api/admin/market-radar`
- `/api/admin/ebay-winner-pipeline`
- `/api/admin/active-listing-risks`
- `/api/admin/ebay/oauth`

## Allowed Staging/Lab Behavior

Staging, preview, development and local lab runtimes can continue to use eBay Pro. The fast gate is designed to block only production-core runtime.

## Data Flow

```text
Local VM / Lab DB
  heavy tests and workers
  -> small approved summaries

IMNOVA Staging
  controlled eBay Pro validation
  -> approved business outcome only if needed

IMNOVA Production
  IMNOVA Core only
```

## What This Does Now

- Adds a runtime boundary for eBay Pro routes.
- Blocks eBay Pro paths in production.
- Allows eBay Pro paths in staging/lab.
- Returns JSON 403 for API routes in production.
- Redirects protected admin pages to `/admin` in production.
- Keeps IMNOVA Core routes unblocked.

## What This Does Not Do Yet

- It does not move tables.
- It does not reduce staging IO by itself.
- It does not connect the local VM.
- It does not run workers.
- It does not connect eBay.
- It does not add OAuth.
- It does not create drafts or publish.

## Next Fast Steps

1. Add staging-only eBay Pro feature flags.
2. Move heavy tests to the Local Network VM.
3. Keep staging on summaries and controlled samples.
4. Add production checks that prevent heavy eBay Pro imports from Admin Home.
5. Evaluate a separate eBay Pro database/project if volume keeps growing.
