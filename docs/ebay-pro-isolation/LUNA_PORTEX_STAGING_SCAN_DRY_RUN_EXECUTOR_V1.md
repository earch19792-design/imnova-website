# Luna Portex Staging Scan Dry Run Executor V1

## Why

eBay Pro needs a controlled first real Luna Portex scan path before any Staging write is allowed. This loop creates a local dry-run executor that simulates the scan pipeline with versioned fixtures only.

## Current state

Production is Core-only, clean, and off-limits. Staging is reserved for eBay Pro, but this loop does not write to Staging. VM/Lab is documented for future heavy processing and remains not connected.

## Production status

Production is not touched. The dry-run does not read from Production, write to Production, connect to Production data, or generate any Production side effects.

## Staging dry-run role

Staging remains the intended eBay Pro control environment. This executor models the future Staging scan flow locally, with writes disabled and candidate persistence disabled.

## VM/Lab status

VM/Lab remains pending for future heavy scan work. This loop does not connect to VM/Lab, does not ping it, and does not read or write any lab database.

## What this executor does

The dry-run executor accepts a local Luna Portex catalog fixture, normalizes products, excludes `PRE_BASELINE_DEMO`, classifies eligible products as `FIRST_REAL_LUNA_PORTEX_SCAN`, builds candidate previews, and returns a dry-run summary.

## What this executor does not do

It does not execute a real scan, write to any database, call external services, create listing drafts, publish listings, send seller alerts, scrape data, download data, upload files, or create SQL.

## Input fixture

The input fixture is `tools/fixtures/luna-portex-staging-scan-sample-catalog-v1.json`. It is a small simulated catalog with no sensitive data, no external URLs, no images, no customer data, and no supplier secrets.

## Candidate preview

Candidate previews are local objects only. They include stock readiness, estimated margin when possible, warning state, and `persistCandidate: false`.

## PRE_BASELINE_DEMO exclusion

Records marked `PRE_BASELINE_DEMO` are excluded before normalization and preview generation. Demo records must not be mixed into the first real scan preview.

## FIRST_REAL_LUNA_PORTEX_SCAN classification

Eligible local fixture records are normalized as `FIRST_REAL_LUNA_PORTEX_SCAN` previews. This classification is dry-run only and does not persist anything.

## Limits

The dry-run limit is `maxProductsPerDryRun <= 20`. The sample catalog contains fewer than 6 products.

## WhatsApp dry-run rule

Seller alerts remain dry-run by default. This loop performs no real messaging.

## Safety checklist

- Production remains off-limits.
- Staging write paths remain disabled.
- VM/Lab remains disconnected.
- Demo records are excluded.
- Candidate previews are not persisted.
- No database connection is created.
- No external call is made.
- No environment file, dump, image, or secret is added.

## Next steps

The next phase can add a controlled Staging write gate or a VM/Lab connection step, but only after separate approval. This loop stops at local fixture dry-run execution.
