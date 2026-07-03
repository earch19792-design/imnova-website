# Disk IO Static Guardrails V1

## Why

Supabase reported a Disk IO Budget warning for `imnova-staging`. The Admin and eBay modules now include large mixed pages and panels, which increases the risk that one screen loads too much data or that a new change adds an expensive query by accident.

The main risks are:

- `select("*")` reads in Admin/eBay paths.
- Queries without explicit limits or ranges.
- Lightweight hubs accidentally importing heavy panels.
- Pages mixing Market Radar, eBay Seller OS and eBay Listing responsibilities.

This loop adds static guardrails before optimizing database queries or changing runtime behavior. It documents existing debt, protects the new lightweight hubs and creates tests that fail when risky patterns are added outside the approved baseline.

## What this protects

This guardrail protects the lightweight hubs:

- `/admin/market-radar`
- `/admin/ebay-seller-os`
- `/admin/ebay-listing`

It also protects future summary endpoints:

- `/api/admin/market-radar/summary`
- `/api/admin/ebay-seller-os/summary`
- `/api/admin/ebay-listing/summary`

The goal is to keep hubs lightweight, prevent heavy panel imports and stop new dangerous `select("*")` reads from entering `app`, `components` or `lib` unless an explicit allowlist entry exists.

## Known debt

The following debt is known and intentionally allowed as a temporary baseline in this loop:

- `lib/products-service.ts` contains existing `select("*")` reads.
- `lib/ebay-winner-pipeline/service.mjs` contains existing `select("*")` reads.
- `lib/ebay-winner-pipeline/price-intelligence-service.mjs` contains existing `select("*")` reads.
- `lib/ebay-winner-pipeline/admin-read-service.mjs` contains an existing `select("*")` read.
- `app/admin/page.tsx` remains a mega-dashboard.
- `app/api/admin/market-radar/route.ts` remains a heavy route.
- `tools/ebay-winner-pipeline-tests.mjs` remains monolithic.

This loop does not fix those items. It prevents the debt from growing while future loops reduce it safely.

## Guardrail rules

- Lightweight hubs must not import heavy panels.
- Lightweight hubs must not use Supabase.
- Lightweight hubs must not call fetch.
- Lightweight hubs must not call product loading helpers such as `getProducts`.
- New `select("*")` reads in `app`, `components` or `lib` must fail unless explicitly allowlisted.
- Future summary endpoints must use explicit columns and limits or ranges.
- Future summary endpoints must not perform writes.
- Guardrail loops must not use eBay API, OAuth, real drafts, publication, OpenAI, image generation or uploads.

## Next phases

- 132C summary endpoints read-only.
- 132D lazy loading.
- 132E pagination.
- 132F SQL/index review with approval.
- 132G split tests by domain.
