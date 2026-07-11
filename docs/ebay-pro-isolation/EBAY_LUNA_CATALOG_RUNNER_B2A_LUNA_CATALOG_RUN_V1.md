# EBAY-RESUME-B2A-LUNA-CATALOG-RUN — Controlled Real Luna Catalog Ingestion

## Why

The catalog-ingest framework proved normalization and automated matching with synthetic rows, but correctly stopped at `NEED_REAL_LUNA_CATALOG_FILE`. This runner provides the controlled local bridge for a real Luna CSV, JSON or XLSX export without committing, uploading or printing the catalog.

## Current state

Real eBay read-only data already confirmed the market pattern. PRE/Staging can score supplier candidates, validate packs, estimate margin and inspect shipping/image readiness. The remaining requirement is real Luna supplier data.

## Safe default

Running the CLI without flags returns `safe-default`, performs no file read and recommends `NEED_REAL_LUNA_CATALOG_FILE`. Real execution requires a local path, `LUNA_CATALOG_RUN_APPROVED=YES_I_APPROVE_LOCAL_LUNA_CATALOG_INGEST`, and the exact terminal confirmation `LOCAL_LUNA_CATALOG_INGEST_APPROVED`.

No environment file is created or modified. Approval remains local and its value is never printed.

## Local file handling

CSV and JSON are parsed directly in memory. XLSX is supported only when the optional parser dependency is already installed; otherwise the runner returns `XLSX_PARSER_UNAVAILABLE` and requests a CSV export. The source file is never copied into the repository, rewritten, uploaded or passed to an external service.

## Required columns

The runner validates SKU, product name, description, brand, UPC/GTIN, cost, stock, pack quantity, color, material, weight, dimensions, image URL, category, handling time and shipping notes. Missing columns block execution readiness.

## Sanitized reporting

Only row counts, field-presence counts and the best match summary are printed. The runner does not print the complete catalog, bulk costs, raw rows, full addresses or sensitive supplier data. Image URLs are evaluated for presence but no images are downloaded.

## Luna Catalog Snapshot

Every successful in-memory ingestion builds a logical snapshot with `snapshotId`, `importedAt`, catalog source, product and SKU counts, a deterministic catalog checksum, stock summary and cost summary. The snapshot is part of the sanitized report model; it is not written to disk and does not copy the supplier catalog into Git.

When a previous logical snapshot is supplied to the pure comparison layer, the model detects new and removed products, stock changes, out-of-stock and restocked products, cost changes, pack changes, weight changes, dimension changes, image availability changes and discontinued products.

Each normalized product receives an operational state: `LISTABLE`, `WATCHLIST`, `STOCK_HOLD`, `PRICE_REVIEW`, `REPRICE_REQUIRED`, `DELIST_OR_PAUSE_REQUIRED`, `NEED_SUPPLIER_CONFIRMATION` or `NEW_OPPORTUNITY`. These are recommendations only; this loop performs no listing revision or pause.

## Stock, price and pre-publish guard

Before B2-RUN or LOOP 150 can be considered, the model requires a catalog no older than 24 hours, enough stock for the required quantity, a still-valid supplier cost, margin above the configured threshold, the selected pack quantity, weight and dimensions, an authorized image, no discontinued flag and no high-risk flag.

A failed guard keeps `canProceedToB2Run` and `canPublish` false and routes to `NEED_FRESH_LUNA_CATALOG`, `STOCK_HOLD`, `PRICE_REVIEW`, `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`, `NEED_SUPPLIER_DIMENSIONS`, `NEED_SUPPLIER_IMAGE` or `EBAY-RESUME-HOLD` as appropriate.

## Route decisions

- `NEED_REAL_LUNA_CATALOG_FILE`: no path, unsupported/malformed input or required columns missing.
- `NEED_FRESH_LUNA_CATALOG`: the latest logical snapshot is older than 24 hours.
- `STOCK_HOLD`: stock is zero, insufficient, or the product is discontinued.
- `PRICE_REVIEW`: cost or margin no longer supports the current commercial model.
- `NEED_LUNA_MATCH`: no strong safe product match, or critical cost/stock data is absent.
- `NEED_LUNA_PACK_QUANTITY_CONFIRMATION`: stock cannot fulfill the selected pack.
- `NEED_SUPPLIER_DIMENSIONS`: weight or dimensions are missing.
- `NEED_SUPPLIER_IMAGE`: no authorized image reference is available.
- `NEED_HUMAN_APPROVAL`: the real supplier candidate is operationally complete but still needs approval.
- `EBAY-RESUME-HOLD`: risk or margin fails.
- `EBAY-RESUME-B2-RUN`: only complete real supplier data plus explicit human approval can proceed.

`canPublish` always remains false. Passing a readiness gate does not create a draft, offer, listing or publication.

## Safety boundaries

- Local read-only file access only after three gates.
- No filesystem writes or catalog copies.
- No eBay/API/OAuth, database, scraper or image generation.
- No tokens, secrets or environment files.
- No real catalog committed to Git.
- No full Luna warehouse street address.
- No Amazon track or old eBay sandbox draft track mixing.

## Definition of Done

The runner defaults safe, validates path/type/approval/confirmation, parses CSV and JSON, handles unavailable XLSX safely, checks required columns, builds a logical snapshot and checksum, compares snapshot changes, assigns product states, enforces freshness/stock/price guards, sanitizes output, preserves all write blocks and passes the full regression suite.

## LOOP 152 protection model

This snapshot contract prepares LOOP 152 without executing it. The future controlled model will combine an active-listing monitor, Luna catalog refresh, stock guard, price guard, margin guard, WhatsApp alerts and a manual approval gate. Only a separately authorized future loop may revise quantity, revise price or pause a listing. This loop merely models the evidence, state and recommended action.

## Human explanation rule

Reports must distinguish reading a local real catalog from proving B2-RUN readiness. A file read alone is insufficient: the best match still needs complete supplier facts, positive margin, manageable shipping and human approval.

## Next step

Run the controlled CLI locally with a real Luna CSV or JSON export stored outside the repository. If only XLSX exists and the parser is unavailable, export it to CSV. Review the sanitized best-match result before any move toward `EBAY-RESUME-B2-RUN`.
