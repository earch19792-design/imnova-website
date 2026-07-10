# EBAY-RESUME-B2A-LUNA-CATALOG-INGEST

## Why

Real eBay read-only evidence confirmed market comparables, but B2A-LUNA-MATCH stopped at `NEED_LUNA_MATCH`. Manually searching Luna Portex for every candidate is slow, inconsistent and unsuitable as the normal Seller OS workflow. This loop defines repeatable local catalog ingestion and automated matching.

## Current state

PRE/Staging already separates `marketObservedData` from `supplierConfirmedData`. The current product hypothesis is a black, self-adhesive silicone cable organizer, with observed 1/2/6/10/20-pack signals and a USD 18.99 target price. Luna supplier facts remain unconfirmed.

## Catalog file and columns

The framework accepts normalized rows originating from CSV, Excel/XLSX or JSON. A production importer must map these required columns: SKU, product name, description, brand, UPC/GTIN, cost, stock available, pack quantity, color, material, weight, dimensions, image URL, category, handling time and shipping notes.

## Normalization

Each row is converted to stable text, numeric or null fields. Invalid or missing pack quantities never become valid packs. Weight and dimensions remain structured supplier facts. An image URL represents supplier-authorized availability; the framework does not download, copy or generate an image.

## Automated match

The matcher builds a query from generic eBay keywords, the optimized original title, category and observed pack sizes. It scores lexical overlap, category, pack compatibility, color and material. High-risk terms such as aerosol, battery, supplement, restricted or hazmat reduce the score and can force `EBAY-RESUME-HOLD`.

## Sample versus real catalog

The four-row sample proves normalization, matching, missing-data routes and risk rejection. It includes a strong cable-organizer match, a partial match, an unrelated item and a risky item. It is synthetic and cannot authorize B2-RUN. A strong sample result is marked `sampleMatchOnly: true` and routes to `NEED_REAL_LUNA_CATALOG_FILE`.

A real Luna catalog or fully supplier-confirmed dataset is required because only Luna can prove SKU, cost, stock, pack quantity, weight, dimensions and authorized image availability.

## Pack, margin and fulfillment validation

The observed eBay pack preference is compared with Luna's actual pack quantity and stock. Insufficient quantity routes to `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`. Cost must support a positive estimated gross margin after a conservative shipping reserve. Missing weight or dimensions routes to `NEED_SUPPLIER_DIMENSIONS`; missing authorized image routes to `NEED_SUPPLIER_IMAGE`.

## Route decisions

- `NEED_REAL_LUNA_CATALOG_FILE`: sample match works, but no real catalog was ingested.
- `NEED_LUNA_MATCH`: no sufficiently strong and safe supplier match, or critical cost/stock facts are absent.
- `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`: pack or stock cannot fulfill the observed recommendation.
- `NEED_SUPPLIER_DIMENSIONS`: weight or dimensions are missing.
- `NEED_SUPPLIER_IMAGE`: no supplier-authorized image is available.
- `NEED_HUMAN_APPROVAL`: real data is operationally complete but approval remains pending.
- `EBAY-RESUME-HOLD`: product risk or negative margin blocks progress.
- `EBAY-RESUME-B2-RUN`: only a real, complete, low-risk, positive-margin catalog match with approval may proceed.

## Safety boundaries

This is local dry-run logic. It performs no eBay API, OAuth, database write, scraper, image generation, draft, listing, offer or publication. It handles no secrets or tokens and versions only the safe warehouse alias.

## Definition of Done

The loop documents required columns, normalizes at least four product classes, finds the strong sample match, detects partial/missing data, rejects risk, proves sample-only blocking, keeps `canPublish` false and passes all regressions.

## Human explanation rule

Reports must say clearly whether evidence came from a sample or a real Luna catalog. A sample proves software behavior, not real supplier availability.

## Next step

The initial dry-run routes to `NEED_REAL_LUNA_CATALOG_FILE`. Export Luna's catalog locally as CSV, XLSX or JSON with the required columns, ingest it through a future controlled local runner, and reevaluate the match. Do not share supplier credentials or sensitive catalog access in chat.
